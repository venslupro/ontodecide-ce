/**
 * @fileoverview Route table tests: route ↔ openapi.yaml parity (both
 * directions), Problem code enum, the served document, ETag responses,
 * request mapping of selected routes and WebSocket forwarding.
 */

import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ERROR_CODES, type CallCtx} from '@ontodecide/shared-kernel';
import {TEST_TID} from '@ontodecide/testing';
import {describe, expect, it, vi} from 'vitest';
import {
  ORIGIN,
  TARGET_TID,
  adminToken,
  call,
  makeGateway,
  ownerToken,
  problemOf,
} from './harness_test';
import {OPENAPI_YAML} from './openapi_spec';
import {ROUTES} from './routes';

const HERE = dirname(fileURLToPath(import.meta.url));
const YAML_PATH = join(HERE, '..', 'openapi.yaml');
const RID = 'ri.Supplier.01K6A00000000000000000R001';

/** Operations of an OpenAPI document (minimal line-based YAML reader). */
function openApiOperations(
  yaml: string,
): {method: string; path: string; op: string}[] {
  const out: {method: string; path: string; op: string}[] = [];
  let inPaths = false;
  let path = '';
  let method = '';
  for (const line of yaml.split('\n')) {
    if (/^\S/.test(line)) inPaths = line.startsWith('paths:');
    if (!inPaths) continue;
    const p = /^ {2}(\/\S*):\s*$/.exec(line);
    if (p) {
      path = p[1];
      method = '';
      continue;
    }
    const m = /^ {4}(get|post|put|patch|delete):\s*$/.exec(line);
    if (m) {
      method = m[1].toUpperCase();
      continue;
    }
    const o = /^ {6}operationId:\s*(\S+)\s*$/.exec(line);
    if (o && path && method) out.push({method, path, op: o[1]});
  }
  return out;
}

/** The Problem.code enum of the document. */
function problemCodes(yaml: string): string[] {
  const start = yaml.indexOf('\n    Problem:\n');
  const block = yaml.slice(start, yaml.indexOf('\n        traceId:', start));
  const enumAt = block.indexOf('enum:');
  return [...block.slice(enumAt).matchAll(/^\s+- ([A-Z_]+)\s*$/gm)].map(
    m => m[1],
  );
}

describe('route table ↔ openapi.yaml', () => {
  const yaml = readFileSync(YAML_PATH, 'utf8');
  const ops = openApiOperations(yaml);

  it('declares OpenAPI 3.2.0', () => {
    expect(yaml.startsWith('openapi: 3.2.0\n')).toBe(true);
  });

  it('has unique ops in routes.ts', () => {
    const names = ROUTES.map(r => r.op);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every route op exists in openapi.yaml with the same method and path', () => {
    const byOp = new Map(ops.map(o => [o.op, o]));
    for (const r of ROUTES) {
      expect(byOp.get(r.op), r.op).toEqual({
        method: r.method,
        path: r.path,
        op: r.op,
      });
    }
  });

  it('every openapi operation exists in routes.ts', () => {
    const routeOps = new Set(ROUTES.map(r => r.op));
    expect(ops.length).toBeGreaterThan(0);
    for (const o of ops) expect(routeOps.has(o.op), o.op).toBe(true);
    expect(ops).toHaveLength(ROUTES.length);
  });

  it('Problem.code enumerates exactly ERROR_CODES', () => {
    expect([...problemCodes(yaml)].sort()).toEqual([...ERROR_CODES].sort());
  });

  it('describes the export stream with itemSchema and the stream messages', () => {
    expect(yaml).toMatch(/application\/jsonl:\s*\n\s+itemSchema:/);
    expect(yaml).toContain('x-websocket-messages:');
    expect(yaml).toContain('name: __Host-od_rt');
    expect(yaml).toMatch(/parent: workspace, kind: nav/);
  });

  it('the served module is in sync with openapi.yaml (run gen:openapi)', () => {
    expect(OPENAPI_YAML).toBe(yaml);
  });

  it('GET /openapi.yaml serves the document', async () => {
    const gw = await makeGateway();
    const res = await call(gw, 'GET', '/openapi.yaml');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('yaml');
    expect(await res.text()).toBe(yaml);
  });
});

describe('ETag responses', () => {
  const object = (version: number) => ({
    rid: RID,
    type: 'Supplier',
    primaryKey: 'S1',
    title: 'S1',
    props: {},
    provenance: {},
    version,
    updatedAt: '2026-09-24T08:00:00Z',
  });

  it('objects: GET carries ETag, a missing object is 404', async () => {
    let found = true;
    const gw = await makeGateway({
      objects: {getObject: async () => (found ? (object(5) as never) : null)},
    });
    const token = await ownerToken();
    const res = await call(gw, 'GET', `/objects/${RID}`, {token});
    expect(res.headers.get('etag')).toBe('"v5"');
    found = false;
    const missing = await call(gw, 'GET', `/objects/${RID}`, {token});
    expect(missing.status).toBe(404);
    expect((await problemOf(missing)).code).toBe('NOT_FOUND');
  });

  it('ontology: schema etag on reads and writes; PUT needs apiName = id', async () => {
    const putDefinition = vi.fn(async () => ({etag: 4}));
    const gw = await makeGateway({
      ontology: {
        getOntology: async () =>
          ({etag: 3, definition: {}, custom: true}) as never,
        listDefinitions: async () =>
          ({items: [], etag: 3, custom: true}) as never,
        getDefinition: async () => ({item: {}, etag: 3}) as never,
        putDefinition,
        deleteDefinition: async () => ({etag: 5}),
      },
    });
    const token = await ownerToken();
    expect(
      (await call(gw, 'GET', '/ontology', {token})).headers.get('etag'),
    ).toBe('"v3"');
    expect(
      (await call(gw, 'GET', '/link-types', {token})).headers.get('etag'),
    ).toBe('"v3"');
    expect(
      (await call(gw, 'GET', '/object-types/Supplier', {token})).headers.get(
        'etag',
      ),
    ).toBe('"v3"');
    const link = {
      apiName: 'supplies',
      displayName: 'Supplies',
      from: 'Supplier',
      to: 'Part',
      cardinality: 'many',
    };
    const created = await call(gw, 'POST', '/link-types', {
      token,
      body: link,
      headers: {'if-match': '"v3"'},
    });
    expect(created.status).toBe(201);
    expect(created.headers.get('etag')).toBe('"v4"');
    expect(putDefinition).toHaveBeenCalledWith(
      expect.anything(),
      'link-types',
      'supplies',
      link,
      3,
    );
    const mismatch = await call(gw, 'PUT', '/link-types/other', {
      token,
      body: link,
      headers: {'if-match': '"v4"'},
    });
    expect(mismatch.status).toBe(400);
    const del = await call(gw, 'DELETE', '/link-types/supplies', {
      token,
      headers: {'if-match': '"v4"'},
    });
    expect(del.status).toBe(204);
    expect(del.headers.get('etag')).toBe('"v5"');
  });

  it('automations and admin settings carry their version as ETag', async () => {
    const automation = {
      id: 'a1',
      version: 2,
      name: 'Low stock',
      trigger: 'threshold',
      objectType: 'Part',
      condition: {op: 'lt', prop: 'stock', value: 5},
      severity: 'HIGH',
      cooldownSec: 3600,
      enabled: true,
      nextRunAt: null,
      lastFiredAt: null,
    };
    const adminPatchSettings = vi.fn(async () => ({version: 8}) as never);
    const gw = await makeGateway({
      situation: {
        getAutomation: async () => automation as never,
        createAutomation: async () => automation as never,
      },
      identity: {
        adminGetSettings: async () => ({version: 7}) as never,
        adminPatchSettings,
      },
    });
    const owner = await ownerToken();
    expect(
      (await call(gw, 'GET', '/automations/a1', {token: owner})).headers.get(
        'etag',
      ),
    ).toBe('"v2"');
    const created = await call(gw, 'POST', '/automations', {
      token: owner,
      body: {
        name: 'Low stock',
        trigger: 'threshold',
        objectType: 'Part',
        condition: {op: 'lt', prop: 'stock', value: 5},
        severity: 'HIGH',
      },
    });
    expect(created.status).toBe(201);
    expect(created.headers.get('etag')).toBe('"v2"');
    const admin = await adminToken();
    expect(
      (await call(gw, 'GET', '/admin/settings', {token: admin})).headers.get(
        'etag',
      ),
    ).toBe('"v7"');
    const patched = await call(gw, 'PATCH', '/admin/settings', {
      token: admin,
      body: {signupEnabled: false},
      headers: {
        'if-match': '"v7"',
        'idempotency-key': 'key-0123456789abcdef',
        'x-step-up': 'su',
      },
    });
    expect(patched.headers.get('etag')).toBe('"v8"');
    expect(adminPatchSettings).toHaveBeenCalledWith(
      expect.anything(),
      {signupEnabled: false},
      7,
      'su',
      'key-0123456789abcdef',
    );
  });
});

describe('request mapping', () => {
  it('GET /objects parses filter JSON, orderBy and paging', async () => {
    const listObjects = vi.fn(async () => ({items: [], nextCursor: null}));
    const gw = await makeGateway({objects: {listObjects}});
    const filter = encodeURIComponent(
      JSON.stringify({op: 'gt', prop: 'risk', value: 0.5}),
    );
    const res = await call(
      gw,
      'GET',
      `/objects?type=Supplier&q=acme&filter=${filter}&orderBy=risk:desc&limit=20&cursor=abc`,
      {token: await ownerToken()},
    );
    expect(res.status).toBe(200);
    expect(listObjects).toHaveBeenCalledWith(
      expect.anything(),
      {
        type: 'Supplier',
        q: 'acme',
        filter: {op: 'gt', prop: 'risk', value: 0.5},
        orderBy: {prop: 'risk', dir: 'desc'},
      },
      {cursor: 'abc', limit: 20},
    );
    const bad = await call(gw, 'GET', '/objects?filter=%7Bnope', {
      token: await ownerToken(),
    });
    expect(bad.status).toBe(400);
  });

  it('POST /action-types/{id}/executions builds ApplyActionCmd', async () => {
    const applyAction = vi.fn(async () => ({version: 6}) as never);
    const gw = await makeGateway({objects: {applyAction}});
    const res = await call(gw, 'POST', '/action-types/expedite/executions', {
      token: await ownerToken(),
      body: {target: RID},
      headers: {'if-match': '"v5"', 'idempotency-key': 'key-0123456789abcdef'},
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBe('"v6"');
    expect(applyAction).toHaveBeenCalledWith(expect.anything(), {
      actionType: 'expedite',
      target: RID,
      params: {},
      ifMatch: 5,
      idempotencyKey: 'key-0123456789abcdef',
    });
  });

  it('DELETE /admin/users/{uid} passes archive flag and reason → 202', async () => {
    const adminDeleteUser = vi.fn(async () => undefined);
    const gw = await makeGateway({identity: {adminDeleteUser}});
    const res = await call(
      gw,
      'DELETE',
      `/admin/users/${TEST_TID}?archive=false`,
      {
        token: await adminToken(),
        body: {reason: 'spam'},
        headers: {'idempotency-key': 'key-0123456789abcdef', 'x-step-up': 'su'},
      },
    );
    expect(res.status).toBe(202);
    expect(adminDeleteUser).toHaveBeenCalledWith(
      expect.anything(),
      TEST_TID,
      {archive: false, reason: 'spam'},
      'su',
      'key-0123456789abcdef',
    );
  });

  it('public archive-deletion routes need no token', async () => {
    const deleteArchiveByToken = vi.fn(async () => undefined);
    const gw = await makeGateway({identity: {deleteArchiveByToken}});
    const token = 'A'.repeat(43);
    const res = await call(gw, 'POST', `/archive-deletions/${token}`);
    expect(res.status).toBe(204);
    expect(deleteArchiveByToken).toHaveBeenCalledWith(token);
  });
});

describe('GET /situation/stream (WebSocket)', () => {
  const ticket = `${TEST_TID}.${'r'.repeat(32)}`;

  function wsHeaders(extra: Record<string, string> = {}) {
    return {upgrade: 'websocket', connection: 'Upgrade', ...extra};
  }

  it('forwards the original request to SITUATION.fetch', async () => {
    const seen: Request[] = [];
    const gw = await makeGateway({
      situationFetch: async req => {
        seen.push(req);
        return new Response('upgraded', {headers: {'x-room': 'ok'}});
      },
    });
    const res = await call(gw, 'GET', `/situation/stream?ticket=${ticket}`, {
      headers: wsHeaders(),
    });
    expect(res.headers.get('x-room')).toBe('ok');
    expect(seen).toHaveLength(1);
    expect(new URL(seen[0].url).searchParams.get('ticket')).toBe(ticket);
    expect(seen[0].headers.get('upgrade')).toBe('websocket');
    expect(seen[0].headers.get('origin')).toBe(ORIGIN);
  });

  it('rejects a foreign or missing Origin (403) before forwarding', async () => {
    const fetchSpy = vi.fn(async () => new Response('x'));
    const gw = await makeGateway({situationFetch: fetchSpy});
    for (const origin of ['https://evil.example', false] as const) {
      const res = await call(gw, 'GET', `/situation/stream?ticket=${ticket}`, {
        headers: wsHeaders(),
        origin,
      });
      expect(res.status).toBe(403);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('requires the Upgrade header (426) and a well-formed ticket (401)', async () => {
    const fetchSpy = vi.fn(async () => new Response('x'));
    const gw = await makeGateway({situationFetch: fetchSpy});
    const noUpgrade = await call(
      gw,
      'GET',
      `/situation/stream?ticket=${ticket}`,
    );
    expect(noUpgrade.status).toBe(426);
    const noTicket = await call(gw, 'GET', '/situation/stream', {
      headers: wsHeaders(),
    });
    expect(noTicket.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('stream tickets are issued in the Act-as target workspace', async () => {
    let ctx: CallCtx | undefined;
    const gw = await makeGateway({
      situation: {
        issueStreamTicket: async c => {
          ctx = c;
          return {ticket: `${c.tid}.x`, expiresIn: 30};
        },
      },
    });
    const res = await call(gw, 'POST', '/situation/stream-tickets', {
      token: await adminToken(),
      headers: {'x-act-as-tenant': TARGET_TID},
    });
    expect(res.status).toBe(201);
    expect(ctx?.tid).toBe(TARGET_TID);
    expect(ctx?.actor.actingAs).toBe(true);
  });
});
