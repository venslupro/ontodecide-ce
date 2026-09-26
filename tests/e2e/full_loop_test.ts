/**
 * @fileoverview The MVP closed loop (总体设计 6.3) end to end through the
 * gateway: login → pack → 3 sources → fusion → alert → recommendation →
 * approval → execution → evaluation.
 */

import {beforeAll, describe, expect, it} from 'vitest';
import type {TokenPair} from '../../packages/identity/contract/index';
import type {
  JobDto,
  SourceDto,
} from '../../packages/integration/contract/index';
import type {
  ObjectDto,
  ObjectPage,
} from '../../packages/object-graph/contract/index';
import type {
  AlertDto,
  SituationOverview,
} from '../../packages/situation/contract/index';
import type {
  RecommendationDto,
  ScenarioResult,
} from '../../packages/decision/contract/index';
import type {CompiledModel} from '../../packages/ontology/contract/index';
import {DAY_MS, HOUR_MS} from '../../packages/shared-kernel/index';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  createHarness,
  type Harness,
} from './harness';
import {SOURCES, readSample} from './fixtures';

describe('closed loop', () => {
  let h: Harness;
  const sourceIds: Record<string, string> = {};
  let s002: ObjectDto;
  let alert: AlertDto;
  let rec: RecommendationDto;

  beforeAll(() => {
    h = createHarness();
  });

  it('bootstraps the admin on first login and sets the refresh cookie', async () => {
    const res = await h.api<TokenPair>('POST', '/auth/login', {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('Admin');
    expect(res.body).not.toHaveProperty('refreshToken');
    expect(res.headers.get('set-cookie')).toMatch(/od_refresh=.*HttpOnly/i);
    h.setToken(res.body.accessToken);

    const refreshed = await h.ok<TokenPair>('POST', '/auth/refresh');
    h.setToken(refreshed.accessToken);
    const me = await h.ok<{email: string}>('GET', '/me');
    expect(me.email).toBe(ADMIN_EMAIL);
  });

  it('rejects anonymous calls with Problem Details', async () => {
    const r = await h.api<{code: string}>(
      'GET',
      '/objects/Supplier',
      undefined,
      {
        authorization: 'Bearer nope',
      },
    );
    expect(r.status).toBe(401);
    expect(r.headers.get('content-type')).toMatch(/problem\+json/);
    expect(r.body.code).toBe('AUTH_INVALID');
  });

  it('imports the supply-chain pack (schema + automations + KPIs)', async () => {
    await h.ok('POST', '/ontology/packs:import', {packId: 'supply-chain'});
    const model = await h.ok<CompiledModel>('GET', '/ontology/model');
    expect(Object.keys(model.objectTypes).sort()).toEqual([
      'Material',
      'Product',
      'Supplier',
    ]);
    const automations = await h.ok<unknown[]>('GET', '/automations');
    expect(automations).toHaveLength(2);
    const kpis = await h.ok<unknown[]>('GET', '/kpis');
    expect(kpis).toHaveLength(4);
  });

  it('fuses three sources into one object graph', async () => {
    for (const s of SOURCES) {
      const src = await h.ok<SourceDto>('POST', '/sources', s.def);
      sourceIds[s.file] = src.id;
      const res = await h.api<{jobId: string}>(
        'POST',
        `/sources/${src.id}/batches`,
        {seq: 0, last: true, records: readSample(s.file)},
        {'idempotency-key': `load-${s.file}`},
      );
      expect(res.status).toBe(202);
      await h.drain();
      const job = await h.ok<JobDto>('GET', `/jobs/${res.body.jobId}`);
      expect(job.status).toBe('Succeeded');
      expect(job.rejected).toBe(0);
      expect(job.received).toBe(readSample(s.file).length);
    }
    const suppliers = await h.ok<ObjectPage>(
      'GET',
      '/objects/Supplier?limit=50',
    );
    const materials = await h.ok<ObjectPage>(
      'GET',
      '/objects/Material?limit=50',
    );
    const products = await h.ok<ObjectPage>('GET', '/objects/Product?limit=50');
    expect(suppliers.items).toHaveLength(5);
    expect(materials.items).toHaveLength(4);
    expect(products.items).toHaveLength(3);
    // Stub objects created for link targets were filled by later sources.
    expect(
      materials.items.every(m => typeof m.props.category === 'string'),
    ).toBe(true);

    s002 = suppliers.items.find(o => o.primaryKey === 'S-002')!;
    const detail = await h.ok<ObjectDto>(
      'GET',
      `/objects/rid/${encodeURIComponent(s002.rid)}?expand=links&depth=2`,
    );
    expect(detail.links?.some(l => l.type === 'supplies')).toBe(true);
    expect(detail.provenance.riskScore.sourceId).toBe(
      sourceIds['suppliers.csv'],
    );
  });

  it('skips unchanged records on re-ingest (props_hash)', async () => {
    const res = await h.ok<{jobId: string}>(
      'POST',
      `/sources/${sourceIds['products.csv']}/batches`,
      {
        seq: 0,
        last: true,
        records: readSample('products.csv'),
      },
    );
    await h.drain();
    const job = await h.ok<JobDto>('GET', `/jobs/${res.jobId}`);
    expect(job.skipped).toBe(3);
    expect(job.upserted + job.merged).toBe(0);
  });

  it('computes KPIs on the cockpit overview', async () => {
    const overview = await h.ok<SituationOverview & {dataHealth: unknown[]}>(
      'GET',
      '/situation/overview',
    );
    const demand = overview.kpis.find(k =>
      JSON.stringify(k.name).includes('Total daily demand'),
    );
    expect(demand?.value).toBe(320 + 180 + 450);
    expect(overview.dataHealth).toHaveLength(3);
  });

  it('simulates a supplier disruption deterministically', async () => {
    const result = await h.ok<ScenarioResult>('POST', '/scenarios:run', {
      perturbations: [{rid: s002.rid, property: 'capacity', change: -0.6}],
    });
    expect(result.scenario.fulfillableDemand).toBeLessThan(
      result.baseline.fulfillableDemand,
    );
    expect(result.affected.some(a => a.type === 'Product')).toBe(true);
  });

  it('raises a HIGH alert and a recommendation when a supplier becomes risky', async () => {
    const risky = readSample('suppliers.csv')
      .filter(r => r.supplierId === 'S-002')
      .map(r => ({...r, riskScore: '86'}));
    await h.ok('POST', `/sources/${sourceIds['suppliers.csv']}/batches`, {
      seq: 0,
      last: true,
      records: risky,
    });
    await h.drain();

    const alerts = await h.ok<AlertDto[]>('GET', '/alerts?status=OPEN');
    const high = alerts.filter(a => a.severity === 'HIGH');
    expect(high).toHaveLength(1);
    alert = high[0];
    expect(alert.rid).toBe(s002.rid);

    const recs = await h.ok<RecommendationDto[]>(
      'GET',
      '/recommendations?status=Proposed',
    );
    rec = recs.find(r => r.alertId === alert.id)!;
    expect(rec).toBeDefined();
    expect(rec.focus).toBe(s002.rid);
    expect(rec.actions.length).toBeGreaterThan(0);
    expect(rec.evidence.length).toBeGreaterThan(0);
    // No LLM is configured → deterministic rule-based fallback.
    expect(rec.model).toBe('rules');

    const overview = await h.ok<SituationOverview>(
      'GET',
      '/situation/overview',
    );
    expect(overview.recommendations.some(r => r.id === rec.id)).toBe(true);
  });

  it('dedupes the alert while it is open', async () => {
    const again = readSample('suppliers.csv')
      .filter(r => r.supplierId === 'S-002')
      .map(r => ({...r, riskScore: '90'}));
    await h.ok('POST', `/sources/${sourceIds['suppliers.csv']}/batches`, {
      seq: 0,
      last: true,
      records: again,
    });
    await h.drain();
    const alerts = await h.ok<AlertDto[]>('GET', '/alerts?status=OPEN');
    const high = alerts.filter(a => a.severity === 'HIGH');
    expect(high).toHaveLength(1);
    expect(high[0].hits).toBeGreaterThan(1);
    const recs = await h.ok<RecommendationDto[]>('GET', '/recommendations');
    expect(recs.filter(r => r.alertId === alert.id)).toHaveLength(1);
  });

  it('refuses to apply an approval-required action without a voucher', async () => {
    const top = rec.actions.find(a => a.rank === 1)!;
    const r = await h.api<{code: string}>(
      'POST',
      `/actions/${top.actionType}/apply`,
      {
        target: top.target,
        params: top.params,
      },
    );
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('APPROVAL_REQUIRED');
  });

  it('approves and executes the recommendation (idempotently)', async () => {
    const approved = await h.ok<RecommendationDto>(
      'POST',
      `/recommendations/${rec.id}/approve`,
      undefined,
      {'idempotency-key': `approve-${rec.id}`},
    );
    expect(approved.status).toBe('Executed');
    const replay = await h.api<RecommendationDto>(
      'POST',
      `/recommendations/${rec.id}/approve`,
      undefined,
      {'idempotency-key': `approve-${rec.id}`},
    );
    expect(replay.status).toBe(200);
    expect(replay.headers.get('idempotent-replay')).toBe('true');

    const second = await h.api<{code: string}>(
      'POST',
      `/recommendations/${rec.id}/approve`,
    );
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('INVALID_TRANSITION');

    const top = approved.actions.find(a => a.rank === 1)!;
    const log = await h.ok<{actionType: string; recommendationId?: string}[]>(
      'GET',
      `/objects/rid/${encodeURIComponent(top.target)}/actions`,
    );
    expect(
      log.some(
        l => l.actionType === top.actionType && l.recommendationId === rec.id,
      ),
    ).toBe(true);
    await h.drain();
  });

  it('evaluates the outcome after 24 hours', async () => {
    h.clock.advance(DAY_MS + HOUR_MS);
    await h.cron('decision', '0 1 * * *');
    // The 15-minute access token expired; renew it with the 7-day refresh cookie.
    const expired = await h.api<{code: string}>(
      'GET',
      `/recommendations/${rec.id}`,
    );
    expect(expired.body.code).toBe('AUTH_EXPIRED');
    h.setToken((await h.ok<TokenPair>('POST', '/auth/refresh')).accessToken);
    const evaluated = await h.ok<RecommendationDto>(
      'GET',
      `/recommendations/${rec.id}`,
    );
    expect(evaluated.status).toBe('Evaluated');
    expect(evaluated.outcome).toBeDefined();
  });

  it('keeps tenants isolated and enforces roles', async () => {
    const viewer = await h.ok<{user: {id: string}; temporaryPassword: string}>(
      'POST',
      '/users',
      {
        email: 'viewer@ontodecide.local',
        name: 'Viewer',
        role: 'Viewer',
        password: 'Viewer12345A',
      },
    );
    expect(viewer.user.id).toBeTruthy();
    h.clearAuth();
    const login = await h.ok<TokenPair>('POST', '/auth/login', {
      email: 'viewer@ontodecide.local',
      password: 'Viewer12345A',
    });
    h.setToken(login.accessToken);
    const r = await h.api<{code: string}>('POST', '/sources', SOURCES[0].def);
    expect(r.status).toBe(403);
    // Viewer lacks the PII marking: contactEmail is hidden.
    const obj = await h.ok<ObjectDto>(
      'GET',
      `/objects/rid/${encodeURIComponent(s002.rid)}`,
    );
    expect(obj.props.contactEmail).toBeUndefined();
    expect(obj.hiddenProps).toContain('contactEmail');
  });

  it('serves an OpenAPI 3.1 document', async () => {
    const doc = await h.ok<{openapi: string; paths: Record<string, unknown>}>(
      'GET',
      '/openapi.json',
    );
    expect(doc.openapi).toMatch(/^3\.1/);
    expect(Object.keys(doc.paths).length).toBeGreaterThan(50);
  });
});
