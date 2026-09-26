/**
 * @fileoverview End-to-end paths beyond the core loop: LLM-ranked
 * recommendations (with sensitive-data redaction and locale), webhook
 * ingestion with HMAC + replay protection, rejected-record replay and
 * dead-letter handling.
 */

import {beforeAll, describe, expect, it} from 'vitest';
import {FakeLlm} from '../../packages/decision/infrastructure/index';
import type {RecommendationDto} from '../../packages/decision/contract/index';
import type {
  JobDto,
  RawRecordDto,
  SourceDto,
} from '../../packages/integration/contract/index';
import type {ObjectPage} from '../../packages/object-graph/contract/index';
import type {DeadLetterDto} from '../../packages/situation/contract/index';
import type {TokenPair} from '../../packages/identity/contract/index';
import {hmacSha256Hex} from '../../packages/shared-kernel/index';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  createHarness,
  type Harness,
} from './harness';
import {SOURCES, readSample} from './fixtures';

/** Answers like a well-behaved model: ranks the whitelisted candidates. */
function rankingModel(prompt: string): string {
  const line = (name: string) =>
    JSON.parse(
      prompt
        .split('\n')
        .find(l => l.startsWith(`${name}: `))!
        .slice(name.length + 2),
    );
  const candidates = line('CANDIDATES') as {
    actionType: string;
    target: string;
    params: object;
    expectedImpact: number;
  }[];
  const facts = line('FACTS') as {
    rid: string;
    props: Record<string, unknown>;
  }[];
  const fact = facts.find(f => Object.keys(f.props).length > 0)!;
  return JSON.stringify({
    summary: '建议切换至低风险供应商以保障交付',
    rationale: '模拟显示该动作恢复的可满足需求最多。',
    actions: candidates.slice(0, 2).map((c, i) => ({...c, rank: i + 1})),
    risks: ['新供应商爬坡期'],
    confidence: 0.82,
    evidence: [{rid: fact.rid, prop: Object.keys(fact.props)[0]}],
  });
}

async function setup(h: Harness): Promise<Record<string, string>> {
  const login = await h.ok<TokenPair>('POST', '/auth/login', {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  h.setToken(login.accessToken);
  await h.ok('POST', '/ontology/packs:import', {packId: 'supply-chain'});
  const ids: Record<string, string> = {};
  for (const s of SOURCES) {
    const src = await h.ok<SourceDto>('POST', '/sources', s.def);
    ids[s.file] = src.id;
    await h.ok('POST', `/sources/${src.id}/batches`, {
      seq: 0,
      last: true,
      records: readSample(s.file),
    });
    await h.drain();
  }
  return ids;
}

describe('LLM-ranked recommendations', () => {
  const llm = new FakeLlm({
    model: 'fake-gpt-oss-20b',
    replies: [(p, o) => rankingModel(`${o.system ?? ''}\n${p}`)],
  });
  let h: Harness;

  beforeAll(async () => {
    h = createHarness({decisionOverrides: {llm}});
    await setup(h);
  });

  it('uses the model output within the whitelist and redacts sensitive props', async () => {
    const suppliers = await h.ok<ObjectPage>('GET', '/objects/Supplier');
    const s001 = suppliers.items.find(o => o.primaryKey === 'S-001')!;
    const {jobId} = await h.ok<{jobId: string}>(
      'POST',
      '/recommendations:generate',
      {
        focus: s001.rid,
        locale: 'zh-CN',
      },
    );
    await h.drain();
    const rec = await h.ok<RecommendationDto>(
      'GET',
      `/recommendations/${jobId}`,
    );
    expect(rec.status).toBe('Proposed');
    expect(rec.model).toBe('fake-gpt-oss-20b');
    expect(rec.summary).toBe('建议切换至低风险供应商以保障交付');
    // Without Neo4j the 3-hop traversal falls back to D1 (2 hops) → degraded.
    expect(rec.degraded).toBe(rec.simulation?.degraded ?? false);
    expect(rec.actions[0].rank).toBe(1);
    const prompts = llm.calls
      .map(c => `${c.opts.system ?? ''}${c.prompt}`)
      .join('\n');
    expect(prompts).not.toContain('@szpp.example'); // contactEmail is sensitive
    expect(prompts).toContain('CANDIDATES');
    const quota = await h.ok<{userRemaining: number}>('GET', '/llm/quota');
    expect(quota.userRemaining).toBeLessThan(20);
  });

  it('falls back to rules when the model invents an action', async () => {
    llm.script(
      JSON.stringify({
        summary: 'x',
        actions: [
          {
            actionType: 'deleteEverything',
            target: 'ri.x.y.z',
            params: {},
            expectedImpact: 9,
            rank: 1,
          },
        ],
        risks: [],
        confidence: 1,
        evidence: [{rid: 'ri.x.y.z', prop: 'a'}],
      }),
    );
    const suppliers = await h.ok<ObjectPage>('GET', '/objects/Supplier');
    const s003 = suppliers.items.find(o => o.primaryKey === 'S-003')!;
    const {jobId} = await h.ok<{jobId: string}>(
      'POST',
      '/recommendations:generate',
      {focus: s003.rid},
    );
    await h.drain();
    const rec = await h.ok<RecommendationDto>(
      'GET',
      `/recommendations/${jobId}`,
    );
    expect(rec.status).toBe('Proposed');
    expect(rec.model).toBe('rules');
    expect(rec.actions.every(a => a.actionType !== 'deleteEverything')).toBe(
      true,
    );
  });
});

describe('webhook, rejects and dead letters', () => {
  let h: Harness;
  let ids: Record<string, string>;

  beforeAll(async () => {
    h = createHarness();
    ids = await setup(h);
  });

  it('accepts signed webhooks and blocks replays and bad signatures', async () => {
    const src = await h.ok<SourceDto>('POST', '/sources', {
      ...SOURCES[2].def,
      name: 'Products webhook',
      kind: 'webhook',
    });
    expect(src.webhookSecret).toBeTruthy();
    const body = JSON.stringify([
      {
        productId: 'P-903',
        name: 'Rugged Tablet',
        dailyDemand: '75',
        inventoryDays: '3',
        safetyStockDays: '2',
        revenuePerUnit: '999',
      },
    ]);
    const ts = String(Math.floor(h.clock.now().getTime() / 1000));
    const sig = await hmacSha256Hex(src.webhookSecret!, `${ts}.${body}`);
    const send = (signature: string) =>
      h.gateway.fetch(
        new Request(`http://x/api/v1/ingest/webhook/${src.id}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-od-timestamp': ts,
            'x-od-signature': signature,
          },
          body,
        }),
      );
    expect((await send(sig)).status).toBe(202);
    expect((await send(sig)).status).toBe(409);
    expect((await send('0'.repeat(64))).status).toBe(401);
    await h.drain();
    const products = await h.ok<ObjectPage>('GET', '/objects/Product');
    expect(products.items.some(p => p.primaryKey === 'P-903')).toBe(true);
    // inventoryDays 3 < 5 → the "Low inventory" automation fires.
    const alerts = await h.ok<{severity: string}[]>(
      'GET',
      '/alerts?status=OPEN',
    );
    expect(alerts.some(a => a.severity === 'MEDIUM')).toBe(true);
  });

  it('stores rejected rows and replays them after correction', async () => {
    const bad = [
      {
        productId: 'P-950',
        name: 'Broken',
        dailyDemand: 'lots',
        inventoryDays: '4',
        safetyStockDays: '1',
        revenuePerUnit: '1',
      },
    ];
    const {jobId} = await h.ok<{jobId: string}>(
      'POST',
      `/sources/${ids['products.csv']}/batches`,
      {seq: 0, last: true, records: bad},
    );
    await h.drain();
    const job = await h.ok<JobDto>('GET', `/jobs/${jobId}`);
    expect(job.rejected).toBe(1);
    expect(job.status).not.toBe('Succeeded');
    const rejected = await h.ok<RawRecordDto[]>(
      'GET',
      `/jobs/${jobId}/rejected`,
    );
    expect(rejected).toHaveLength(1);
    const fixed = {...rejected[0].payload, dailyDemand: '40'};
    const replay = await h.ok<{requeued: number}>(
      'POST',
      `/jobs/${jobId}/replay`,
      {fixes: [{id: rejected[0].id, payload: fixed}]},
    );
    expect(replay.requeued).toBe(1);
    await h.drain();
    const products = await h.ok<ObjectPage>('GET', '/objects/Product?limit=50');
    expect(
      products.items.find(p => p.primaryKey === 'P-950')?.props.dailyDemand,
    ).toBe(40);
  });

  it('stores dead letters and replays them from the admin API', async () => {
    const me = await h.ok<{tenantId: string}>('GET', '/me');
    const suppliers = await h.ok<ObjectPage>('GET', '/objects/Supplier');
    const ctx = {
      tenantId: me.tenantId,
      userId: 'system',
      roles: ['Admin'],
      markings: ['*'],
      requestId: 'dlq',
      correlationId: 'dlq',
    };
    // A decision job that exhausted its retries lands in decision-jobs-dlq.
    await h.bus
      .sender('decision-jobs-dlq')
      .send({ctx, jobId: 'job-from-dlq', focus: suppliers.items[0].rid});
    await h.drain();
    const letters = await h.ok<DeadLetterDto[]>('GET', '/admin/dlq');
    const letter = letters.find(d => d.queue.startsWith('decision-jobs'));
    expect(letter).toBeDefined();
    const res = await h.ok<{replayed: number}>(
      'POST',
      '/admin/dlq/decision-jobs/replay',
      {ids: [letter!.id]},
    );
    expect(res.replayed).toBe(1);
    await h.drain();
    const rec = await h.ok<RecommendationDto>(
      'GET',
      '/recommendations/job-from-dlq',
    );
    expect(rec.status).toBe('Proposed');
  });
});
