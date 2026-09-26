/**
 * @fileoverview Integration tests of decision-engine: D1 (node:sqlite),
 * QueueBus, and stub OBJECTS / SITUATION / ONTOLOGY over rpcBinding.
 */

import {beforeEach, describe, expect, it} from 'vitest';
import {
  AppError,
  DAY_MS,
  FixedClock,
  HOUR_MS,
  silentLogger,
  systemCtx,
  type CallCtx,
  type Rid,
} from '@ontodecide/shared-kernel';
import type {
  DecisionRpc,
  RecommendationDto,
} from '@ontodecide/decision/contract';
import type {LlmPort} from '@ontodecide/decision/application';
import {FakeEmbedder, FakeLlm} from '@ontodecide/decision/infrastructure';
import type {ObjectGraphRpc} from '@ontodecide/object-graph/contract';
import type {OntologyRpc} from '@ontodecide/ontology/contract';
import type {
  DecisionJobMsg,
  SituationRpc,
} from '@ontodecide/situation/contract';
import {createTestD1, QueueBus, rpcBinding, testCtx} from '@ontodecide/testing';
import {
  InMemoryObjectGraph,
  RecordingSituation,
  StaticOntology,
} from '../../../packages/decision/infrastructure/testing/stubs';
import {rid} from '../../../packages/decision/domain/testing/supply_chain_fixture';
import type {Env} from './env';
import {createService} from './service';

const SECRET = 'approval-secret';
const S1 = rid('Supplier', 'S-001');
const S5 = rid('Supplier', 'S-005');
const M100 = rid('Material', 'M-100');
const P900 = rid('Product', 'P-900');
const QUEUE = 'decision-jobs';

interface Harness {
  rpc: DecisionRpc;
  db: D1Database;
  bus: QueueBus;
  clock: FixedClock;
  graph: InMemoryObjectGraph;
  situation: RecordingSituation;
  drain(): Promise<number>;
  svc: ReturnType<typeof createService>;
}

function setup(opts: {llm?: LlmPort; env?: Partial<Env>} = {}): Harness {
  const db = createTestD1('decision');
  const bus = new QueueBus();
  const clock = new FixedClock('2026-09-24T00:00:00Z');
  const graph = new InMemoryObjectGraph(SECRET, clock);
  const situation = new RecordingSituation();
  const env: Env = {
    DECISION_DB: db,
    OBJECTS: rpcBinding(graph as unknown as ObjectGraphRpc),
    SITUATION: rpcBinding(situation as unknown as SituationRpc),
    ONTOLOGY: rpcBinding(new StaticOntology() as unknown as OntologyRpc),
    DECISION_JOBS_QUEUE: bus.sender<DecisionJobMsg>(QUEUE),
    APPROVAL_SECRET: SECRET,
    ...opts.env,
  };
  const svc = createService(env, {
    clock,
    logger: silentLogger,
    embedder: new FakeEmbedder(),
    ...(opts.llm ? {llm: opts.llm} : {}),
  });
  return {
    rpc: rpcBinding(svc.rpc),
    db,
    bus,
    clock,
    graph,
    situation,
    svc,
    drain: () =>
      bus.drain({
        [QUEUE]: {
          handler: b => svc.queue!(b),
          maxBatchSize: 5,
          maxRetries: 3,
          deadLetterQueue: `${QUEUE}-dlq`,
        },
      }),
  };
}

const operator = (over: Partial<CallCtx> = {}) =>
  testCtx({role: 'Operator', ...over});

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return AppError.from(e).code;
  }
  return 'NO_ERROR';
}

/** Automation-path job (jobId minted by situation-awareness). */
function automationJob(jobId: string, focus: Rid = S1): DecisionJobMsg {
  return {
    ctx: systemCtx('t1', 'corr-auto'),
    jobId,
    alertId: 'alert-1',
    focus,
    perturbation: {property: 'capacity', change: -0.6},
    locale: 'zh-CN',
  };
}

const VALID_ADVICE = JSON.stringify({
  summary: '深圳精密产能下降，建议将铝壳体切换至曼谷金属成型。',
  rationale: '推演显示切换后可满足需求显著回升。',
  actions: [
    {
      actionType: 'switchSupplier',
      target: M100,
      params: {newSupplier: 'ri.t1.Supplier.HACK'},
      expectedImpact: 9,
      rank: 1,
    },
  ],
  risks: ['新供应商爬坡期'],
  confidence: 0.82,
  evidence: [
    {rid: S1, prop: 'capacity'},
    {rid: P900, prop: 'dailyDemand'},
  ],
});

async function proposed(
  h: Harness,
  jobId = 'job-1',
): Promise<RecommendationDto> {
  await h.bus.sender<DecisionJobMsg>(QUEUE).send(automationJob(jobId));
  await h.drain();
  return h.rpc.getRecommendation(operator(), jobId);
}

describe('runScenario', () => {
  let h: Harness;
  beforeEach(() => {
    h = setup();
  });

  it('propagates a supplier capacity drop to products and scores actions', async () => {
    const res = await h.rpc.runScenario(operator(), {
      perturbations: [{rid: S1, property: 'capacity', change: -0.6}],
      candidateActions: [
        {actionType: 'switchSupplier', target: M100, params: {newSupplier: S5}},
        {actionType: 'increaseSafetyStock', target: P900},
      ],
    });
    const types = new Set(res.affected.map(a => a.type));
    expect(types).toEqual(new Set(['Supplier', 'Material', 'Product']));
    expect(res.baseline.fulfillableDemand).toBeGreaterThan(
      res.scenario.fulfillableDemand,
    );
    const withSwitch = res.withActions![`switchSupplier:${M100}`];
    expect(withSwitch.fulfillableDemand).toBeGreaterThan(
      res.scenario.fulfillableDemand,
    );
    expect(
      res.withActions![`increaseSafetyStock:${P900}`].fulfillableDemand,
    ).toBeGreaterThan(res.scenario.fulfillableDemand);
    expect(res.riskLevel).toBe('HIGH');
    expect(res.degraded).toBe(false);
    expect(h.graph.impactQueries[0]).toMatchObject({
      linkTypes: ['supplies', 'usedIn'],
      maxHops: 3,
      limit: 500,
    });
  });

  it('persists results for stored scenarios', async () => {
    const s = await h.rpc.createScenario(operator(), {
      name: 'S-001 outage',
      perturbations: [{rid: S1, property: 'capacity', change: -0.6}],
    });
    await h.rpc.runScenario(operator(), {scenarioId: s.id} as never);
    const got = await h.rpc.getScenario(operator(), s.id);
    expect(got.result?.baseline.fulfillableDemand).toBe(500);
    expect((await h.rpc.listScenarios(operator())).map(x => x.id)).toEqual([
      s.id,
    ]);
  });

  it('rejects invalid perturbations and oversized graphs', async () => {
    const many = Array.from({length: 11}, () => ({
      rid: S1,
      property: 'capacity',
      change: -0.1,
    }));
    expect(
      await code(h.rpc.runScenario(operator(), {perturbations: many})),
    ).toBe('PERTURBATION_INVALID');
    expect(
      await code(
        h.rpc.runScenario(operator(), {
          perturbations: [
            {
              rid: 'ri.t2.Supplier.S-001' as Rid,
              property: 'capacity',
              change: -0.1,
            },
          ],
        }),
      ),
    ).toBe('PERTURBATION_INVALID');
    expect(
      await code(
        h.rpc.runScenario(operator(), {
          perturbations: [{rid: S1, property: 'capacity', change: -2}],
        }),
      ),
    ).toBe('PERTURBATION_INVALID');
    h.graph.inflate = 501;
    expect(
      await code(
        h.rpc.runScenario(operator(), {
          perturbations: [{rid: S1, property: 'capacity', change: -0.1}],
        }),
      ),
    ).toBe('GRAPH_TOO_LARGE');
  });

  it('checks roles through the RPC boundary', async () => {
    expect(
      await code(
        h.rpc.runScenario(testCtx({role: 'Viewer'}), {
          perturbations: [{rid: S1, property: 'capacity', change: -0.1}],
        }),
      ),
    ).toBe('FORBIDDEN');
    expect(
      await code(h.rpc.getRecommendation(testCtx({role: 'Viewer'}), 'nope')),
    ).toBe('NOT_FOUND');
    expect(await code(h.rpc.getScenario(operator(), 'nope'))).toBe('NOT_FOUND');
  });

  it('lists candidates with the lowest-risk active supplier prefilled', async () => {
    const cands = await h.rpc.listCandidateActions(operator(), [
      {rid: S1, property: 'capacity', change: -0.6},
    ]);
    const sw = cands.find(
      c => c.actionType === 'switchSupplier' && c.target === M100,
    )!;
    expect(sw.params).toEqual({newSupplier: S5});
    expect(sw.eligible).toBe(true);
    expect(cands[0].eligible).toBe(true);
  });
});

describe('recommendation jobs', () => {
  it('turns an automation DecisionJobMsg into a Proposed recommendation (valid LLM JSON)', async () => {
    const llm = new FakeLlm({replies: [VALID_ADVICE]});
    const h = setup({llm});
    const rec = await proposed(h);
    expect(rec.status).toBe('Proposed');
    expect(rec.model).toBe('fake-llm');
    expect(rec.degraded).toBe(false);
    expect(rec.alertId).toBe('alert-1');
    expect(rec.confidence).toBe(0.82);
    expect(rec.actions).toHaveLength(1);
    expect(rec.actions[0]).toMatchObject({
      actionType: 'switchSupplier',
      target: M100,
      params: {newSupplier: S5},
      rank: 1,
      requiresApproval: true,
    });
    expect(rec.actions[0].expectedImpact).toBeGreaterThan(0);
    // Evidence: LLM refs first, then focus / KPI inputs; values + provenance from OBJECTS.
    expect(rec.evidence[0]).toMatchObject({
      rid: S1,
      prop: 'capacity',
      value: 1200,
      provenance: {sourceId: 'src-supplier'},
    });
    expect(
      rec.evidence.some(
        e => e.rid === P900 && e.prop === 'dailyDemand' && e.value === 320,
      ),
    ).toBe(true);
    expect(
      rec.simulation?.withActions?.[`switchSupplier:${M100}`],
    ).toBeDefined();
    // Prompt carries redacted facts only, and asks for the locale.
    const prompt = llm.calls[0].prompt + llm.calls[0].opts.system;
    expect(prompt).not.toContain('ops@szpp.example');
    expect(prompt).not.toContain('contactEmail');
    expect(prompt).toContain('Simplified Chinese');
    expect(h.situation.pushed.at(-1)).toMatchObject({
      id: 'job-1',
      status: 'Proposed',
      focus: S1,
    });
    expect(h.situation.usage).toEqual([{resource: 'ai.neurons', n: 76}]);
  });

  it('retries once on invalid JSON and falls back to rules', async () => {
    const llm = new FakeLlm({replies: ['not json at all']});
    const h = setup({llm});
    const rec = await proposed(h);
    expect(llm.calls).toHaveLength(2);
    expect(rec.status).toBe('Proposed');
    expect(rec.model).toBe('rules');
    expect(rec.degraded).toBe(true);
    expect(rec.confidence).toBe(0.6);
    expect(rec.actions[0]).toMatchObject({
      actionType: 'switchSupplier',
      target: M100,
      params: {newSupplier: S5},
      rank: 1,
    });
    expect(rec.actions.length).toBeLessThanOrEqual(3);
    expect(rec.summary).toContain('切换供应商');
    expect(rec.evidence.length).toBeGreaterThan(0);
    expect(h.situation.usage).toEqual([{resource: 'ai.neurons', n: 152}]);
  });

  it('is idempotent for jobs already past Draft', async () => {
    const llm = new FakeLlm({replies: [VALID_ADVICE]});
    const h = setup({llm});
    await proposed(h);
    await h.bus.sender<DecisionJobMsg>(QUEUE).send(automationJob('job-1'));
    await h.drain();
    expect(llm.calls).toHaveLength(1);
    expect(h.situation.pushed).toHaveLength(1);
  });

  it('skips the LLM when the tenant quota is exhausted (rules, degraded)', async () => {
    const llm = new FakeLlm({replies: [VALID_ADVICE]});
    const h = setup({llm, env: {LLM_TENANT_DAILY_LIMIT: '0'}});
    const rec = await proposed(h);
    expect(llm.calls).toHaveLength(0);
    expect(rec).toMatchObject({model: 'rules', degraded: true});
    expect(h.situation.usage).toEqual([]);
    expect(await h.rpc.llmQuota(operator())).toEqual({
      userRemaining: 20,
      tenantRemaining: 0,
    });
  });

  it('generates manually (en-US, no providers → rules)', async () => {
    const h = setup();
    const {jobId} = await h.rpc.generateRecommendation(operator(), {
      focus: S1,
      locale: 'en-US',
    });
    expect(h.bus.size(QUEUE)).toBe(1);
    const draft = await h.rpc.getRecommendation(operator(), jobId);
    expect(draft).toMatchObject({status: 'Draft', locale: 'en-US'});
    expect(
      new Date(draft.expiresAt).getTime() - new Date(draft.createdAt).getTime(),
    ).toBe(24 * HOUR_MS);
    await h.drain();
    const rec = await h.rpc.getRecommendation(operator(), jobId);
    expect(rec.status).toBe('Proposed');
    expect(rec.model).toBe('rules');
    expect(rec.summary).toMatch(
      /^Shenzhen Precision Parts: Fulfillable daily demand expected to drop/,
    );
    expect(
      (await h.rpc.listRecommendations(operator(), {status: 'Proposed'})).map(
        r => r.id,
      ),
    ).toEqual([jobId]);
    expect(await h.rpc.listRecommendations(operator(), {focus: P900})).toEqual(
      [],
    );
  });

  it('marks the recommendation Failed when the focus does not exist', async () => {
    const h = setup();
    await h.bus
      .sender<DecisionJobMsg>(QUEUE)
      .send(automationJob('job-x', rid('Supplier', 'S-404')));
    await h.drain();
    const rec = await h.rpc.getRecommendation(operator(), 'job-x');
    expect(rec.status).toBe('Failed');
    expect(h.situation.pushed.at(-1)).toMatchObject({
      id: 'job-x',
      status: 'Failed',
    });
    expect(h.bus.size(`${QUEUE}-dlq`)).toBe(0);
  });
});

describe('approval', () => {
  it('approves with a valid voucher, executes, and rejects a second approval', async () => {
    const h = setup();
    const rec = await proposed(h);
    const out = await h.rpc.approve(operator({userId: 'op-1'}), rec.id);
    expect(out.status).toBe('Executed');
    expect(out.approvedBy).toBe('op-1');
    expect(out.actions[0].execution).toEqual({
      status: 'Executed',
      actionLogId: 'log-1',
    });
    expect(h.graph.applied).toHaveLength(1);
    const {cmd} = h.graph.applied[0];
    expect(cmd).toMatchObject({
      actionType: 'switchSupplier',
      target: M100,
      params: {newSupplier: S5},
      recommendationId: rec.id,
    });
    expect(cmd.approval).toMatchObject({
      recommendationId: rec.id,
      tenantId: 't1',
      expiresAt: new Date(h.clock.now().getTime() + 600_000).toISOString(),
    });
    expect(h.situation.pushed.at(-1)).toMatchObject({
      id: rec.id,
      status: 'Executed',
    });
    expect(await code(h.rpc.approve(operator(), rec.id))).toBe(
      'INVALID_TRANSITION',
    );
    expect(h.graph.applied).toHaveLength(1);
  });

  it('records ExecFailed when applyAction fails', async () => {
    const h = setup();
    const rec = await proposed(h);
    h.graph.failNext = 'PRECONDITION_FAILED';
    const out = await h.rpc.approve(operator(), rec.id);
    expect(out.status).toBe('ExecFailed');
    expect(out.actions[0].execution).toMatchObject({
      status: 'Failed',
      error: expect.stringContaining('PRECONDITION_FAILED'),
    });
  });

  it('refuses expired recommendations and Viewers', async () => {
    const h = setup();
    const rec = await proposed(h);
    expect(await code(h.rpc.approve(testCtx({role: 'Viewer'}), rec.id))).toBe(
      'FORBIDDEN',
    );
    h.clock.advance(25 * HOUR_MS);
    expect(await code(h.rpc.approve(operator(), rec.id))).toBe(
      'INVALID_TRANSITION',
    );
  });

  it('rejects with a reason and stores feedback', async () => {
    const h = setup();
    const rec = await proposed(h);
    expect(await code(h.rpc.reject(operator(), rec.id, ''))).toBe(
      'VALIDATION_FAILED',
    );
    const out = await h.rpc.reject(
      operator(),
      rec.id,
      'Supplier already contracted',
    );
    expect(out).toMatchObject({
      status: 'Rejected',
      rejectReason: 'Supplier already contracted',
    });
    expect(await code(h.rpc.approve(operator(), rec.id))).toBe(
      'INVALID_TRANSITION',
    );
    const fb = await h.rpc.feedback(operator(), rec.id, {
      rating: 4,
      comment: 'useful',
    });
    expect(fb.feedback).toEqual({rating: 4, comment: 'useful'});
    expect(await code(h.rpc.feedback(operator(), rec.id, {rating: 6}))).toBe(
      'VALIDATION_FAILED',
    );
  });
});

describe('evaluateOutcomes', () => {
  it('expires stale Draft/Proposed recommendations', async () => {
    const h = setup();
    const rec = await proposed(h);
    const {jobId: draft} = await h.rpc.generateRecommendation(operator(), {
      focus: S1,
    });
    expect(await h.rpc.evaluateOutcomes(h.clock.now().toISOString())).toEqual({
      evaluated: 0,
      expired: 0,
    });
    h.clock.advance(24 * HOUR_MS + 1);
    expect(await h.rpc.evaluateOutcomes(h.clock.now().toISOString())).toEqual({
      evaluated: 0,
      expired: 2,
    });
    expect((await h.rpc.getRecommendation(operator(), rec.id)).status).toBe(
      'Expired',
    );
    expect((await h.rpc.getRecommendation(operator(), draft)).status).toBe(
      'Expired',
    );
    expect(h.situation.pushed.filter(p => p.status === 'Expired')).toHaveLength(
      2,
    );
  });

  it('evaluates executed recommendations after 24 h and stores the case', async () => {
    const llm = new FakeLlm({replies: [VALID_ADVICE]});
    const h = setup({llm});
    const rec = await proposed(h);
    await h.rpc.approve(operator(), rec.id);
    h.clock.advance(12 * HOUR_MS);
    await h.svc.scheduled!('0 1 * * *', h.clock.now());
    expect((await h.rpc.getRecommendation(operator(), rec.id)).status).toBe(
      'Executed',
    );
    h.clock.advance(DAY_MS);
    await h.svc.scheduled!('0 1 * * *', h.clock.now());
    const out = await h.rpc.getRecommendation(operator(), rec.id);
    expect(out.status).toBe('Evaluated');
    const expected =
      rec.simulation!.withActions![`switchSupplier:${M100}`].fulfillableDemand;
    expect(out.outcome).toMatchObject({
      expected,
      actual: 500,
      evaluatedAt: h.clock.now().toISOString(),
    });
    expect(out.outcome!.achievement).toBeCloseTo(
      Math.min(2, 500 / expected),
      3,
    );
    const row = await h.db
      .prepare(
        'SELECT tenant_id, summary, outcome, embedding FROM dec_case WHERE id = ?',
      )
      .bind(rec.id)
      .first<Record<string, string>>();
    expect(row?.tenant_id).toBe('t1');
    expect(row?.summary).toBe(rec.summary);
    expect(JSON.parse(row!.embedding).vector).toHaveLength(64);
    // The stored case is recalled (RAG) for the next recommendation.
    await proposed(h, 'job-2');
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1].prompt).toContain('SIMILAR_CASES: [{"summary":');
    expect(llm.calls[1].prompt).toContain(rec.summary);
  });
});

describe('suggestMapping', () => {
  const targetProps = [
    {apiName: 'supplierId', dataType: 'string', displayName: 'Supplier ID'},
    {apiName: 'name', dataType: 'string', displayName: 'Name'},
    {apiName: 'country', dataType: 'string'},
    {apiName: 'riskScore', dataType: 'double', displayName: 'Risk score'},
    {apiName: 'capacity', dataType: 'double'},
    {apiName: 'onTimeRate', dataType: 'double'},
    {apiName: 'status', dataType: 'enum'},
    {apiName: 'contactEmail', dataType: 'string', displayName: 'Contact email'},
  ];
  const fields = [
    'supplierId',
    'name',
    'country',
    'riskScore',
    'capacity',
    'onTimeRate',
    'status',
    'contactEmail',
    'materials',
    'share',
  ];
  const rows = [
    [
      'S-001',
      'Shenzhen Precision Parts',
      'CN',
      35,
      1200,
      0.96,
      'active',
      'ops@szpp.example',
      'M-100;M-101',
      0.7,
    ],
  ];
  const modeler = testCtx({role: 'Modeler'});

  it('falls back to the heuristic for suppliers.csv headers', async () => {
    const h = setup();
    const m = await h.rpc.suggestMapping(modeler, {
      fields,
      rows,
      targetType: 'Supplier',
      targetProps,
    });
    expect(m.model).toBe('rules');
    expect(m.primaryKey.from).toBe('supplierId');
    expect(m.fields).toHaveLength(8);
    expect(m.fields.every(f => f.from === f.to)).toBe(true);
    expect(
      await code(
        h.rpc.suggestMapping(operator(), {
          fields,
          rows,
          targetType: 'Supplier',
          targetProps,
        }),
      ),
    ).toBe('FORBIDDEN');
  });

  it('uses validated LLM output and counts it against the quota', async () => {
    const llm = new FakeLlm({
      replies: [
        JSON.stringify({
          primaryKey: {from: 'supplierId'},
          fields: [{to: 'name', from: 'name', confidence: 0.9}],
        }),
      ],
    });
    const h = setup({llm});
    const m = await h.rpc.suggestMapping(modeler, {
      fields,
      rows,
      targetType: 'Supplier',
      targetProps,
    });
    expect(m).toEqual({
      targetType: 'Supplier',
      primaryKey: {from: 'supplierId'},
      fields: [{to: 'name', from: 'name', confidence: 0.9}],
      model: 'fake-llm',
    });
    expect(await h.rpc.llmQuota(modeler)).toEqual({
      userRemaining: 19,
      tenantRemaining: 49,
    });
  });

  it('rejects LLM output that maps unknown fields', async () => {
    const llm = new FakeLlm({
      replies: [JSON.stringify({primaryKey: {from: 'id'}, fields: []})],
    });
    const h = setup({llm});
    const m = await h.rpc.suggestMapping(modeler, {
      fields,
      rows,
      targetType: 'Supplier',
      targetProps,
    });
    expect(m.model).toBe('rules');
  });
});

describe('worker wiring', () => {
  it('acks messages of unknown queues and runs the cron', async () => {
    const h = setup();
    const acked: string[] = [];
    await h.svc.queue!({
      queue: 'other-queue',
      messages: [],
      ackAll: () => acked.push('all'),
      retryAll: () => {},
    });
    expect(acked).toEqual(['all']);
    await expect(
      h.svc.scheduled!('0 1 * * *', h.clock.now()),
    ).resolves.toBeUndefined();
  });
});
