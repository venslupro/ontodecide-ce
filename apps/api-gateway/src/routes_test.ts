/**
 * @fileoverview Structural tests of the route table and the OpenAPI doc.
 */

import {isRole} from '@ontodecide/shared-kernel';
import {describe, expect, it} from 'vitest';
import {buildRouter} from './app';
import {buildOpenApi, toOpenApiPath} from './openapi';
import {parseIfMatch, ROUTES} from './routes';

const ACCESS = new Set(['public', 'cookie', 'hmac']);

/** Every row of ARCHITECTURE.md §4. */
const SPEC: string[] = [
  'POST /auth/login',
  'POST /auth/refresh',
  'POST /auth/logout',
  'GET /me',
  'PATCH /me',
  'POST /me/password',
  'GET /users',
  'POST /users',
  'PATCH /users/:id',
  'DELETE /users/:id',
  'POST /users/:id/markings',
  'POST /users/:id/password:reset',
  'GET /ontology/schemas',
  'GET /ontology/schemas/:api',
  'GET /ontology/model',
  'PUT /ontology/schemas/:api/draft',
  'POST /ontology/schemas/:api/diff',
  'POST /ontology/schemas/:api/publish',
  'GET /ontology/schemas/:api/export',
  'GET /ontology/packs',
  'POST /ontology/packs:import',
  'GET /sources',
  'GET /sources/:id',
  'POST /sources',
  'PATCH /sources/:id',
  'DELETE /sources/:id',
  'POST /sources/:id/uploads:presign',
  'POST /sources/:id/batches',
  'POST /sources/:id/mapping:suggest',
  'GET /jobs',
  'GET /jobs/:id',
  'GET /jobs/:id/rejected',
  'POST /jobs/:id/replay',
  'GET /data-health',
  'POST /ingest/webhook/:sourceId',
  'GET /objects/:type',
  'GET /objects/rid/:rid',
  'GET /objects/rid/:rid/lineage',
  'GET /objects/rid/:rid/actions',
  'GET /object-sets',
  'POST /object-sets',
  'POST /object-sets/:id/evaluate',
  'POST /object-sets:evaluate',
  'GET /search',
  'GET /graph/impact',
  'GET /graph/paths',
  'GET /merge-suggestions',
  'POST /merge-suggestions/:id/resolve',
  'POST /actions/:actionType/apply',
  'GET /situation/overview',
  'GET /situation/stream',
  'GET /kpis',
  'POST /kpis',
  'DELETE /kpis/:id',
  'GET /kpis/:id/trend',
  'GET /automations',
  'POST /automations',
  'PUT /automations/:id',
  'DELETE /automations/:id',
  'POST /automations:dry-run',
  'GET /alerts',
  'PATCH /alerts/:id',
  'GET /cockpit/layout',
  'PUT /cockpit/layout',
  'GET /usage',
  'GET /admin/usage',
  'GET /admin/dlq',
  'POST /admin/dlq/:queue/replay',
  'POST /admin/graph:rebuild',
  'GET /scenarios',
  'POST /scenarios',
  'GET /scenarios/:id',
  'POST /scenarios/:id/run',
  'POST /scenarios:run',
  'POST /scenarios:candidates',
  'POST /recommendations:generate',
  'GET /recommendations',
  'GET /recommendations/:id',
  'POST /recommendations/:id/approve',
  'POST /recommendations/:id/reject',
  'POST /recommendations/:id/feedback',
  'GET /llm/quota',
  'GET /config',
  'POST /telemetry',
  'GET /openapi.json',
  'GET /health',
];

describe('route table', () => {
  it('has unique method + path pairs, summaries and valid access', () => {
    const seen = new Set<string>();
    for (const r of ROUTES) {
      const key = `${r.method} ${r.path}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
      expect(r.summary.length, key).toBeGreaterThan(0);
      expect(isRole(r.minRole) || ACCESS.has(r.minRole), key).toBe(true);
      expect(typeof r.handler, key).toBe('function');
    }
  });

  it('implements exactly the ARCHITECTURE §4 rows', () => {
    const actual = ROUTES.map(r => `${r.method} ${r.path}`).sort();
    expect(actual).toEqual([...SPEC].sort());
  });

  it('resolves every route to its own handler', () => {
    const router = buildRouter(ROUTES);
    for (const r of ROUTES) {
      const concrete = r.path.replace(/(^|\/):([A-Za-z]+)/g, '$1x-$2');
      const m = router.match(r.method, concrete);
      expect(m.kind, `${r.method} ${concrete}`).toBe('found');
      if (m.kind === 'found') expect(m.value).toBe(r);
    }
  });

  it('marks the table statuses and groups', () => {
    const find = (key: string) =>
      ROUTES.find(r => `${r.method} ${r.path}` === key)!;
    expect(find('POST /sources/:id/batches')).toMatchObject({
      status: 202,
      idempotent: true,
      rateGroup: 'ingest',
    });
    expect(find('POST /recommendations:generate')).toMatchObject({
      status: 202,
      rateGroup: 'ai',
    });
    expect(find('POST /sources/:id/mapping:suggest').rateGroup).toBe('ai');
    expect(find('POST /ingest/webhook/:sourceId')).toMatchObject({
      status: 202,
      minRole: 'hmac',
      rateGroup: 'webhook',
    });
    expect(find('POST /recommendations/:id/approve')).toMatchObject({
      idempotent: true,
      critical: true,
    });
    expect(find('POST /actions/:actionType/apply').idempotent).toBe(true);
  });

  it('parses If-Match', () => {
    expect(parseIfMatch(null)).toBeUndefined();
    expect(parseIfMatch('3')).toBe(3);
    expect(parseIfMatch('"4"')).toBe(4);
    expect(parseIfMatch('W/"5"')).toBe(5);
    expect(() => parseIfMatch('abc')).toThrow();
  });
});

describe('OpenAPI', () => {
  const doc = buildOpenApi(ROUTES, '1.3.0') as {
    openapi: string;
    paths: Record<string, Record<string, Record<string, unknown>>>;
    components: {schemas: Record<string, unknown>};
  };

  it('is OpenAPI 3.1 with one operation per route', () => {
    expect(doc.openapi).toBe('3.1.0');
    const ids = new Set<string>();
    for (const r of ROUTES) {
      const op = doc.paths[toOpenApiPath(r.path)]?.[r.method.toLowerCase()];
      expect(op, `${r.method} ${r.path}`).toBeDefined();
      expect(op.tags).toEqual([r.service]);
      ids.add(op.operationId as string);
    }
    expect(ids.size).toBe(ROUTES.length);
    expect(doc.components.schemas.Problem).toBeDefined();
  });

  it('uses {param} syntax and zod request bodies', () => {
    expect(toOpenApiPath('/users/:id/password:reset')).toBe(
      '/users/{id}/password:reset',
    );
    const login = doc.paths['/auth/login'].post as {
      requestBody: {
        content: {'application/json': {schema: {properties: object}}};
      };
      security: unknown[];
    };
    expect(
      Object.keys(
        login.requestBody.content['application/json'].schema.properties,
      ),
    ).toEqual(['email', 'password']);
    expect(login.security).toEqual([]);
    const listObjects = doc.paths['/objects/{type}'].get as {
      parameters: {name: string; in: string}[];
    };
    expect(listObjects.parameters.map(p => `${p.in}:${p.name}`)).toEqual([
      'path:type',
      'query:filter',
      'query:orderBy',
      'query:cursor',
      'query:limit',
    ]);
  });
});
