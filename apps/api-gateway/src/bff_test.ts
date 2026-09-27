/**
 * @fileoverview BFF aggregations: GET /me quotas, GET /situation/overview,
 * the GET /me/export JSON Lines stream, sample data routing and
 * GET /objects/{rid}?expand=links.
 */

import type {SituationOverview} from '@ontodecide/situation/contract';
import {AppError, type CallCtx} from '@ontodecide/shared-kernel';
import {TEST_TID} from '@ontodecide/testing';
import {describe, expect, it, vi} from 'vitest';
import {
  TARGET_TID,
  adminToken,
  call,
  makeGateway,
  ownerToken,
  problemOf,
  sampleMe,
} from './harness_test';

const usageServices = {
  identity: {
    getMe: async () => sampleMe(),
    usage: async () => [{key: 'sessions' as const, used: 2, limit: 3}],
  },
  integration: {
    usage: async () => [
      {key: 'importRowsToday' as const, used: 150, limit: 2000},
      {key: 'mappingDraftsToday' as const, used: 1, limit: 2},
    ],
  },
  decision: {
    usage: async () => [{key: 'aiRecsToday' as const, used: 3, limit: 3}],
  },
  objects: {
    stats: async () => ({objects: 80, links: 160, byType: {Supplier: 10}}),
  },
};

describe('GET /me', () => {
  it('merges MeDto with the quotas of every service', async () => {
    const gw = await makeGateway(usageServices);
    const res = await call(gw, 'GET', '/me', {token: await ownerToken()});
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({...sampleMe()});
    expect(body.quotas).toEqual({
      objects: {used: 80, limit: 300},
      links: {used: 160, limit: 900},
      importRowsToday: {used: 150, limit: 2000},
      aiRecsToday: {used: 3, limit: 3},
      mappingDraftsToday: {used: 1, limit: 2},
      sessions: {used: 2, limit: 3},
      resetsAt: '2026-09-25T00:00:00.000Z',
    });
    for (const s of [
      'IDENTITY.getMe',
      'IDENTITY.usage',
      'INTEGRATION.usage',
      'DECISION.usage',
      'OBJECTS.stats',
    ]) {
      expect(gw.calls).toContain(s);
    }
  });

  it('a failing usage source reads 0/0; a failing getMe fails the request', async () => {
    const gw = await makeGateway({
      ...usageServices,
      decision: {
        usage: async () => {
          throw new Error('down');
        },
      },
    });
    const res = await call(gw, 'GET', '/me', {token: await ownerToken()});
    const body = (await res.json()) as {quotas: Record<string, unknown>};
    expect(body.quotas.aiRecsToday).toEqual({used: 0, limit: 0});

    const broken = await makeGateway({
      ...usageServices,
      identity: {
        ...usageServices.identity,
        getMe: async () => {
          throw new AppError('TRIAL_EXPIRED');
        },
      },
    });
    const r2 = await call(broken, 'GET', '/me', {token: await ownerToken()});
    expect(r2.status).toBe(401);
    expect((await problemOf(r2)).code).toBe('TRIAL_EXPIRED');
  });

  it('under Act-as the quotas are those of the target workspace', async () => {
    const tids: string[] = [];
    const gw = await makeGateway({
      ...usageServices,
      objects: {
        stats: async (ctx: CallCtx) => {
          tids.push(ctx.tid);
          return {objects: 1, links: 1, byType: {}};
        },
      },
    });
    await call(gw, 'GET', '/me', {
      token: await adminToken(),
      headers: {'x-act-as-tenant': TARGET_TID},
    });
    expect(tids).toEqual([TARGET_TID]);
  });
});

describe('GET /situation/overview', () => {
  const overview: SituationOverview = {
    kpis: [],
    trends: [],
    alerts: [],
    impacted: [],
    initialized: true,
    generatedAt: '2026-09-24T08:00:00Z',
  };

  it('merges the overview, 5 pending recommendations and the quotas', async () => {
    const listRecommendations = vi.fn(async () => ({
      items: [{id: 'r1'}, {id: 'r2'}] as never[],
      nextCursor: 'more',
    }));
    const situationOverview = vi.fn(async () => overview);
    const gw = await makeGateway({
      ...usageServices,
      situation: {overview: situationOverview},
      decision: {...usageServices.decision, listRecommendations},
    });
    const res = await call(gw, 'GET', '/situation/overview?range=7d', {
      token: await ownerToken(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ...overview,
      pendingRecommendations: [{id: 'r1'}, {id: 'r2'}],
    });
    expect((body.quotas as Record<string, unknown>).objects).toEqual({
      used: 80,
      limit: 300,
    });
    expect(situationOverview.mock.calls[0]).toEqual([
      expect.objectContaining({tid: TEST_TID}),
      {range: '7d'},
    ]);
    expect(listRecommendations.mock.calls[0]).toEqual([
      expect.anything(),
      {status: 'Proposed'},
      {limit: 5},
    ]);
  });

  it('defaults range to 24h and rejects others', async () => {
    const situationOverview = vi.fn(
      async (_ctx: CallCtx, _q: {range: '24h' | '7d'}) => overview,
    );
    const gw = await makeGateway({
      ...usageServices,
      situation: {overview: situationOverview},
      decision: {
        ...usageServices.decision,
        listRecommendations: async () => ({items: [], nextCursor: null}),
      },
    });
    const token = await ownerToken();
    await call(gw, 'GET', '/situation/overview', {token});
    expect(situationOverview.mock.calls[0][1]).toEqual({range: '24h'});
    const bad = await call(gw, 'GET', '/situation/overview?range=1y', {token});
    expect(bad.status).toBe(400);
  });
});

describe('GET /me/export', () => {
  it('streams every chunk as application/jsonl', async () => {
    const chunks: Record<string, {text: string; nextCursor: string | null}> = {
      start: {text: '{"file":"a.jsonl","data":1}\n', nextCursor: 'c1'},
      c1: {text: '{"file":"a.jsonl","data":2}', nextCursor: 'c2'},
      c2: {text: '', nextCursor: 'c3'},
      c3: {text: '{"file":"b.json","data":{}}\n', nextCursor: null},
    };
    const exportChunk = vi.fn(async (_ctx: CallCtx, cursor: string | null) =>
      structuredClone(chunks[cursor ?? 'start']),
    );
    const gw = await makeGateway({identity: {exportChunk}});
    const res = await call(gw, 'GET', '/me/export', {
      token: await ownerToken(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/jsonl');
    expect(res.headers.get('content-disposition')).toContain(
      'ontodecide-export-2026-09-24.jsonl',
    );
    const text = await res.text();
    const lines = text
      .trimEnd()
      .split('\n')
      .map(l => JSON.parse(l));
    expect(lines).toEqual([
      {file: 'a.jsonl', data: 1},
      {file: 'a.jsonl', data: 2},
      {file: 'b.json', data: {}},
    ]);
    expect(exportChunk.mock.calls.map(c => c[1])).toEqual([
      null,
      'c1',
      'c2',
      'c3',
    ]);
  });

  it('an error on the first chunk is a Problem response', async () => {
    const gw = await makeGateway({
      identity: {
        exportChunk: async () => {
          throw new AppError('FORBIDDEN');
        },
      },
    });
    const res = await call(gw, 'GET', '/me/export', {
      token: await ownerToken(),
    });
    expect(res.status).toBe(403);
  });
});

describe('POST /workspace/sample-data', () => {
  it('routes directly to INTEGRATION.loadSample → 202', async () => {
    const loadSample = vi.fn(
      async () => ({id: 'job-1', kind: 'sample'}) as never,
    );
    const gw = await makeGateway({integration: {loadSample}});
    const res = await call(gw, 'POST', '/workspace/sample-data', {
      token: await ownerToken(),
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({id: 'job-1'});
    expect(gw.calls).toEqual(['INTEGRATION.loadSample']);
  });

  it('forwards CONFLICT when already loaded', async () => {
    const gw = await makeGateway({
      integration: {
        loadSample: async () => {
          throw new AppError('CONFLICT', 'already loaded');
        },
      },
    });
    const res = await call(gw, 'POST', '/workspace/sample-data', {
      token: await ownerToken(),
    });
    expect(res.status).toBe(409);
  });
});

describe('GET /objects/{rid}?expand=links', () => {
  const RID = 'ri.Supplier.01K6A00000000000000000R001';
  const object = {
    rid: RID,
    type: 'Supplier',
    primaryKey: 'S1',
    title: 'S1',
    props: {riskScore: 80},
    provenance: {},
    version: 7,
    updatedAt: '2026-09-24T08:00:00Z',
    derived: {supplierRiskLevel: 'HIGH'},
  };
  const slice = {
    nodes: [{rid: RID, type: 'Supplier', title: 'S1', props: {}, hop: 0}],
    edges: [{type: 'supplies', src: RID, dst: 'ri.Part.X', weight: null}],
    truncated: false,
  };

  it('joins getObject and getLinks; the ETag stays the object version', async () => {
    const getLinks = vi.fn(async (..._a: unknown[]) => slice as never);
    const gw = await makeGateway({
      objects: {getObject: async () => object as never, getLinks},
    });
    const res = await call(
      gw,
      'GET',
      `/objects/${RID}?expand=links&depth=2&linkTypes=supplies`,
      {token: await ownerToken()},
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBe('"v7"');
    expect(await res.json()).toEqual({...object, links: slice});
    expect([...gw.calls].sort()).toEqual([
      'OBJECTS.getLinks',
      'OBJECTS.getObject',
    ]);
    expect(getLinks.mock.calls[0]).toMatchObject([
      expect.anything(),
      RID,
      {depth: 2, direction: 'both', linkTypes: ['supplies']},
    ]);
  });

  it('defaults to depth 1 and never calls getLinks without expand', async () => {
    const getLinks = vi.fn(async (..._a: unknown[]) => slice as never);
    const gw = await makeGateway({
      objects: {getObject: async () => object as never, getLinks},
    });
    const token = await ownerToken();
    await call(gw, 'GET', `/objects/${RID}?expand=links`, {token});
    expect(getLinks.mock.calls[0][2]).toEqual({depth: 1, direction: 'both'});
    const plain = await call(gw, 'GET', `/objects/${RID}`, {token});
    expect(await plain.json()).not.toHaveProperty('links');
    expect(getLinks).toHaveBeenCalledTimes(1);
  });

  it('a missing object is 404 even though getLinks fails too', async () => {
    const gw = await makeGateway({
      objects: {
        getObject: async () => null,
        getLinks: async () => {
          throw new AppError('NOT_FOUND');
        },
      },
    });
    const res = await call(gw, 'GET', `/objects/${RID}?expand=links`, {
      token: await ownerToken(),
    });
    expect(res.status).toBe(404);
    expect((await problemOf(res)).code).toBe('NOT_FOUND');
  });
});
