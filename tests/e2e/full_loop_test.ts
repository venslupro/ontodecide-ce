/**
 * @fileoverview End-to-end core loop through the gateway (ARCHITECTURE.md
 * 6): sign-up → sample data → domain events → cockpit alerts → scenario →
 * recommendation (rule ranking, AI absent) → confirm → action executed as
 * svc:decision-engine; declarative function values and
 * `expand=links` on object reads; plus workspace isolation and If-Match on
 * objects.
 */

import {describe, expect, it} from 'vitest';
import {createSystem, rowsOf, signUp} from './harness';

interface ObjectItem {
  rid: string;
  type: string;
  title: string;
  props: Record<string, unknown>;
  version: number;
  derived?: Record<string, unknown>;
  links?: {nodes: unknown[]; edges: unknown[]; truncated: boolean};
}

describe('core loop', () => {
  it('runs sign-up → sample → alert → scenario → recommendation → action', async () => {
    const sys = await createSystem();
    const owner = await signUp(sys, 'alice@example.com');

    const me = await sys.api<{
      role: string;
      workspace: {kind: string; status: string; trialExpiresAt: string};
      quotas: Record<string, {used: number; limit: number}>;
    }>('GET', '/me', {token: owner.token});
    expect(me.status).toBe(200);
    expect(me.body.role).toBe('owner');
    expect(me.body.workspace).toMatchObject({kind: 'trial', status: 'ACTIVE'});
    expect(Date.parse(me.body.workspace.trialExpiresAt)).toBe(
      sys.clock.now().getTime() + 72 * 3_600_000,
    );
    expect(me.body.quotas.objects).toEqual({used: 0, limit: 300});

    // First cockpit open initializes KPIs and sample automations.
    const empty = await sys.api<{initialized: boolean; kpis: unknown[]}>(
      'GET',
      '/situation/overview?range=24h',
      {token: owner.token},
    );
    expect(empty.status).toBe(200);
    expect(empty.body.initialized).toBe(true);
    expect(empty.body.kpis.length).toBeGreaterThan(0);

    // Sample scenario: 80 objects / 160 links. Reloading is allowed (users
    // may switch scenarios); upserts are keyed so the data stays idempotent.
    const sample = await sys.api('POST', '/workspace/sample-data', {
      token: owner.token,
    });
    expect(sample.status).toBe(202);
    const again = await sys.api<{code: string}>(
      'POST',
      '/workspace/sample-data',
      {token: owner.token},
    );
    expect(again.status).toBe(202);
    expect(await rowsOf(sys.dbs.objects, 'og_object', owner.tid)).toBe(80);
    expect(await rowsOf(sys.dbs.objects, 'og_link', owner.tid)).toBe(160);

    await sys.drain();
    expect(sys.deadLetters()).toBe(0);
    // Delivered outbox rows are deleted.
    expect(await rowsOf(sys.dbs.objects, 'domain_event', owner.tid)).toBe(0);

    const ov = await sys.api<{
      alerts: {severity: string; rid: string | null; status: string}[];
      pendingRecommendations: unknown[];
      quotas: Record<string, {used: number}>;
    }>('GET', '/situation/overview?range=24h', {token: owner.token});
    expect(ov.status).toBe(200);
    const high = ov.body.alerts.filter(a => a.severity === 'HIGH');
    expect(high.length).toBeGreaterThan(0);
    expect(ov.body.quotas.objects.used).toBe(80);
    expect(ov.body.pendingRecommendations).toEqual([]);

    // The riskiest supplier is the focus.
    const suppliers = await sys.api<{items: ObjectItem[]}>(
      'GET',
      '/objects?type=Supplier&limit=100',
      {token: owner.token},
    );
    expect(suppliers.status).toBe(200);
    const focus = [...suppliers.body.items].sort(
      (a, b) => Number(b.props.riskScore) - Number(a.props.riskScore),
    )[0];
    expect(Number(focus.props.riskScore)).toBeGreaterThanOrEqual(70);

    const links = await sys.api<{nodes: unknown[]; edges: unknown[]}>(
      'GET',
      `/objects/${focus.rid}/links?depth=2`,
      {token: owner.token},
    );
    expect(links.status).toBe(200);
    expect(links.body.edges.length).toBeGreaterThan(0);

    // Declarative functions (supplierRiskLevel) are evaluated on reads.
    for (const s of suppliers.body.items) {
      const risk = Number(s.props.riskScore);
      const level = risk >= 70 ? 'HIGH' : risk >= 40 ? 'MEDIUM' : 'LOW';
      expect(s.derived).toEqual({supplierRiskLevel: level});
    }

    // Object detail with its links in one call; the ETag is unchanged.
    const detail = await sys.api<ObjectItem>(
      'GET',
      `/objects/${focus.rid}?expand=links&depth=2`,
      {token: owner.token},
    );
    expect(detail.status).toBe(200);
    expect(detail.headers.get('etag')).toBe(`"v${focus.version}"`);
    expect(detail.body.derived).toEqual({supplierRiskLevel: 'HIGH'});
    expect(detail.body.links?.edges.length).toBe(links.body.edges.length);
    expect(detail.body.links?.nodes.length).toBe(links.body.nodes.length);

    const scenario = await sys.api<{
      id: string;
      result: {baseline: object; scenario: object; affected: unknown[]};
    }>('POST', '/scenarios', {
      token: owner.token,
      body: {
        name: 'Supplier outage',
        perturbations: [{rid: focus.rid, property: 'capacity', change: -0.6}],
      },
    });
    expect(scenario.status).toBe(201);
    expect(scenario.body.result.affected.length).toBeGreaterThan(0);

    const rec = await sys.api<{
      id: string;
      status: string;
      rankedBy: string;
      ranking: string[];
      candidates: {id: string; actionType: string; target: string}[];
    }>('POST', '/recommendations', {
      token: owner.token,
      body: {focus: focus.rid, scenarioId: scenario.body.id},
    });
    expect(rec.status).toBe(201);
    expect(rec.body.status).toBe('Proposed');
    expect(rec.body.rankedBy).toBe('rules');
    expect(rec.body.ranking.length).toBeGreaterThan(0);

    const pending = await sys.api<{pendingRecommendations: {id: string}[]}>(
      'GET',
      '/situation/overview?range=24h',
      {token: owner.token},
    );
    expect(pending.body.pendingRecommendations.map(r => r.id)).toContain(
      rec.body.id,
    );

    // Decision requires an Idempotency-Key; a replay returns the same result.
    const noKey = await sys.api(
      'POST',
      `/recommendations/${rec.body.id}/decision`,
      {
        token: owner.token,
        body: {decision: 'confirm'},
      },
    );
    expect(noKey.status).toBe(400);
    const key = 'e2e-confirm-000000000001';
    const confirmed = await sys.api<{status: string; decidedBy: string}>(
      'POST',
      `/recommendations/${rec.body.id}/decision`,
      {
        token: owner.token,
        body: {decision: 'confirm'},
        headers: {'idempotency-key': key},
      },
    );
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('Executed');
    expect(confirmed.body.decidedBy).toBe('owner');
    const replay = await sys.api<{status: string}>(
      'POST',
      `/recommendations/${rec.body.id}/decision`,
      {
        token: owner.token,
        body: {decision: 'confirm'},
        headers: {'idempotency-key': key},
      },
    );
    expect(replay.body.status).toBe('Executed');

    const top = rec.body.candidates.find(c => c.id === rec.body.ranking[0])!;
    const log = await sys.api<{
      items: {actor: string; recommendationId: string}[];
    }>('GET', `/objects/${top.target}/actions`, {token: owner.token});
    expect(log.status).toBe(200);
    expect(log.body.items).toHaveLength(1);
    expect(log.body.items[0]).toMatchObject({
      actor: 'svc:decision-engine',
      recommendationId: rec.body.id,
    });
    await sys.drain();
    expect(sys.deadLetters()).toBe(0);
  });

  it('isolates workspaces and enforces If-Match on objects', async () => {
    const sys = await createSystem();
    const a = await signUp(sys, 'a@example.com', '198.51.100.31');
    const b = await signUp(sys, 'b@example.com', '198.51.100.32');
    await sys.api('POST', '/workspace/sample-data', {token: a.token});

    const list = await sys.api<{items: ObjectItem[]}>(
      'GET',
      '/objects?type=Supplier',
      {token: a.token},
    );
    // A supplier whose status actually changes: a no-op patch keeps the
    // version, and then the old ETag is (correctly) still current.
    const obj = list.body.items.find(o => o.props.status !== 'watch')!;
    // Workspace B cannot see A's object: same 404 as a missing one.
    const foreign = await sys.api<{code: string}>(
      'GET',
      `/objects/${obj.rid}`,
      {
        token: b.token,
      },
    );
    expect(foreign.status).toBe(404);
    expect(foreign.body.code).toBe('NOT_FOUND');
    const bList = await sys.api<{items: unknown[]}>('GET', '/objects', {
      token: b.token,
    });
    expect(bList.body.items).toEqual([]);

    const got = await sys.api<ObjectItem>('GET', `/objects/${obj.rid}`, {
      token: a.token,
    });
    expect(got.headers.get('etag')).toBe(`"v${got.body.version}"`);
    const etag = got.headers.get('etag')!;
    const patch = (ifMatch: string) =>
      sys.api<ObjectItem & {code?: string}>('PATCH', `/objects/${obj.rid}`, {
        token: a.token,
        body: {status: 'watch'},
        headers: {
          'content-type': 'application/merge-patch+json',
          'if-match': ifMatch,
        },
      });
    const first = await patch(etag);
    expect(first.status).toBe(200);
    expect(first.body.props.status).toBe('watch');
    // A second tab still holding the old ETag gets 412.
    const stale = await patch(etag);
    expect(stale.status).toBe(412);
    expect(stale.body.code).toBe('PRECONDITION_FAILED');
  });

  it('rejects foreign origins, missing tokens and owner Act-as', async () => {
    const sys = await createSystem();
    const owner = await signUp(sys, 'c@example.com');
    const cross = await sys.api<{code: string}>(
      'POST',
      '/workspace/sample-data',
      {
        token: owner.token,
        headers: {origin: 'https://evil.example'},
      },
    );
    expect(cross.status).toBe(403);
    const anon = await sys.api<{code: string; traceId: string}>('GET', '/me');
    expect(anon.status).toBe(401);
    expect(anon.headers.get('content-type')).toContain(
      'application/problem+json',
    );
    expect(anon.body.code).toBe('UNAUTHENTICATED');
    expect(anon.body.traceId).toBeTruthy();
    const actAs = await sys.api<{code: string}>('GET', '/me', {
      token: owner.token,
      headers: {'x-act-as-tenant': owner.tid},
    });
    expect(actAs.status).toBe(403);
    expect(actAs.body.code).toBe('FORBIDDEN');
  });
});
