/**
 * @fileoverview MSW handlers for the `/api/v1` gateway, built from contract
 * types and backed by a resettable in-memory db (see fixtures.ts). Tests
 * override individual endpoints with `server.use(...)`.
 */

import type {
  RecommendationDto,
  ScenarioDto,
} from '@ontodecide/decision/contract';
import type {UserDto} from '@ontodecide/identity/contract';
import type {SourceDto} from '@ontodecide/integration/contract';
import type {ObjectDto, ObjectSetDto} from '@ontodecide/object-graph/contract';
import {
  matchFilter,
  type ErrorCode,
  type FilterExpr,
  type Problem,
  type Rid,
} from '@ontodecide/shared-kernel';
import type {AlertDto, AutomationDto} from '@ontodecide/situation/contract';
import {http, HttpResponse, type JsonBodyType} from 'msw';
import * as fx from './fixtures';

const API = '*/api/v1';

/** Builds a Problem Details response. */
export function problem(
  status: number,
  code: ErrorCode,
  detail?: string,
  extras: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  const body: Problem = {
    type: `https://ontodecide-ce.pages.dev/problems/${code.toLowerCase()}`,
    title: code,
    status,
    code,
    detail,
    requestId: 'req-test',
    ...extras,
  };
  return HttpResponse.json(body as unknown as JsonBodyType, {
    status,
    headers: {'content-type': 'application/problem+json', ...headers},
  });
}

const clone = <T>(v: T): T => structuredClone(v);

function freshDb() {
  return {
    users: clone(fx.users) as UserDto[],
    objects: clone(fx.allObjects) as ObjectDto[],
    objectSets: [] as ObjectSetDto[],
    alerts: clone(fx.alerts) as AlertDto[],
    automations: clone(fx.automations) as AutomationDto[],
    recommendations: [clone(fx.recommendation)] as RecommendationDto[],
    scenarios: clone(fx.scenarios) as ScenarioDto[],
    sources: clone(fx.sources) as SourceDto[],
    jobs: clone(fx.jobs),
    rejected: clone(fx.rejected),
    batches: [] as {
      sourceId: string;
      seq: number;
      last: boolean;
      records: number;
      key: string | null;
      jobId?: string;
    }[],
    /** Whether `/auth/refresh` succeeds (cookie present). */
    refreshOk: true,
    /** User returned by login / refresh. */
    sessionUser: fx.adminUser as UserDto,
    tokenSeq: 0,
  };
}

/** In-memory backend state (reset after each test). */
export let db = freshDb();

/** Resets the in-memory db. */
export function resetDb(): void {
  db = freshDb();
}

function grant() {
  db.tokenSeq += 1;
  return {
    accessToken: `token-${db.tokenSeq}`,
    expiresIn: 900,
    user: db.sessionUser,
  };
}

function neighborsOf(o: ObjectDto, depth: 1 | 2) {
  const seen = new Set<string>([o.rid]);
  let frontier = [o.rid as string];
  const links: ObjectDto['links'] = [];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const r of frontier) {
      for (const e of fx.edges) {
        if (e.src === r || e.dst === r) {
          if (d === 0)
            links.push({
              type: e.type,
              src: e.src,
              dst: e.dst,
              weight: e.weight ?? null,
              direction: e.src === r ? 'out' : 'in',
            });
          const other = e.src === r ? e.dst : e.src;
          if (!seen.has(other)) {
            seen.add(other);
            next.push(other);
          }
        }
      }
    }
    frontier = next;
  }
  seen.delete(o.rid);
  const neighbors = db.objects
    .filter(x => seen.has(x.rid))
    .map(x => ({rid: x.rid, type: x.type, title: x.title}));
  return {links, neighbors};
}

/** Default handlers. */
export const handlers = [
  // --- platform -------------------------------------------------------------
  http.get(`${API}/config`, () =>
    HttpResponse.json({
      features: {neo4j: true, aiMapping: true, darkTheme: true},
      version: '1.3.0',
    }),
  ),
  http.post(`${API}/telemetry`, () => new HttpResponse(null, {status: 204})),

  // --- auth / identity --------------------------------------------------------
  http.post(`${API}/auth/login`, async ({request}) => {
    const body = (await request.json()) as {email: string; password: string};
    if (body.password !== 'Passw0rd!!')
      return problem(401, 'AUTH_INVALID', 'bad credentials');
    const u = db.users.find(x => x.email === body.email) ?? db.sessionUser;
    db.sessionUser = u;
    return HttpResponse.json(grant());
  }),
  http.post(`${API}/auth/refresh`, () =>
    db.refreshOk ? HttpResponse.json(grant()) : problem(401, 'AUTH_EXPIRED'),
  ),
  http.post(`${API}/auth/logout`, () => new HttpResponse(null, {status: 204})),
  http.get(`${API}/me`, () => HttpResponse.json(db.sessionUser)),
  http.patch(`${API}/me`, async ({request}) => {
    db.sessionUser = {
      ...db.sessionUser,
      ...((await request.json()) as Partial<UserDto>),
    };
    return HttpResponse.json(db.sessionUser);
  }),
  http.post(`${API}/me/password`, () => new HttpResponse(null, {status: 204})),
  http.get(`${API}/users`, () => HttpResponse.json(db.users)),
  http.post(`${API}/users`, async ({request}) => {
    const b = (await request.json()) as {
      email: string;
      name: string;
      role: UserDto['role'];
      markings?: string[];
      password?: string;
    };
    const u: UserDto = {
      id: `u${db.users.length + 1}`,
      tenantId: 't1',
      email: b.email,
      name: b.name,
      role: b.role,
      markings: b.markings ?? [],
      disabled: false,
      locale: 'zh-CN',
      mustChangePassword: true,
      createdAt: fx.NOW,
    };
    db.users.push(u);
    return HttpResponse.json(
      {user: u, temporaryPassword: b.password ? undefined : 'Tmp-9xQ2-kLm7'},
      {status: 201},
    );
  }),
  http.patch(`${API}/users/:id`, async ({params, request}) => {
    const u = db.users.find(x => x.id === params.id);
    if (!u) return problem(404, 'NOT_FOUND');
    Object.assign(u, await request.json());
    return HttpResponse.json(u);
  }),
  http.delete(`${API}/users/:id`, ({params}) => {
    db.users = db.users.filter(x => x.id !== params.id);
    return new HttpResponse(null, {status: 204});
  }),
  http.post(`${API}/users/:id/markings`, async ({params, request}) => {
    const u = db.users.find(x => x.id === params.id);
    if (!u) return problem(404, 'NOT_FOUND');
    u.markings = ((await request.json()) as {markings: string[]}).markings;
    return HttpResponse.json(u);
  }),
  http.post(/\/api\/v1\/users\/[^/]+\/password:reset$/, () =>
    HttpResponse.json({temporaryPassword: 'Tmp-Reset-4821'}),
  ),

  // --- ontology ---------------------------------------------------------------
  http.get(`${API}/ontology/model`, () => HttpResponse.json(fx.compiledModel)),
  http.get(`${API}/ontology/schemas`, () =>
    HttpResponse.json(fx.schemaSummaries),
  ),
  http.get(`${API}/ontology/schemas/:api`, ({params, request}) => {
    const version =
      new URL(request.url).searchParams.get('version') ?? 'current';
    if (params.api !== 'supplyChain') return problem(404, 'NOT_FOUND');
    return HttpResponse.json({
      apiName: 'supplyChain',
      version: version === 'draft' ? '1.1.0' : '1.0.0',
      status: version === 'draft' ? 'DRAFT' : 'PUBLISHED',
      definition: fx.supplyChainSchema,
      publishedAt: fx.NOW,
    });
  }),
  http.put(`${API}/ontology/schemas/:api/draft`, ({params}) =>
    HttpResponse.json({
      apiName: params.api,
      version: '1.1.0',
      savedAt: fx.NOW,
      validation: [],
    }),
  ),
  http.post(`${API}/ontology/schemas/:api/diff`, ({params}) =>
    HttpResponse.json({
      apiName: params.api,
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      breaking: true,
      suggestedVersion: '2.0.0',
      changes: [
        {kind: 'propertyAdded', path: 'Supplier.leadTime', breaking: false},
        {
          kind: 'propertyTypeChanged',
          path: 'Supplier.capacity',
          breaking: true,
          detail: 'double → integer',
        },
      ],
    }),
  ),
  http.post(
    `${API}/ontology/schemas/:api/publish`,
    async ({params, request}) => {
      const b = (await request.json().catch(() => ({}))) as {
        confirmVersion?: string;
      };
      if (b.confirmVersion !== '2.0.0')
        return problem(422, 'ONTOLOGY_BREAKING_CHANGE', 'confirm 2.0.0');
      return HttpResponse.json({
        apiName: params.api,
        version: '2.0.0',
        diff: {
          apiName: params.api,
          fromVersion: '1.0.0',
          toVersion: '2.0.0',
          breaking: true,
          changes: [],
          suggestedVersion: '2.0.0',
        },
        indexChanges: [],
        publishedAt: fx.NOW,
      });
    },
  ),
  http.get(`${API}/ontology/schemas/:api/export`, () =>
    HttpResponse.json({
      id: 'supply-chain',
      name: 'Supply chain',
      version: '1.0.0',
      schema: fx.supplyChainSchema,
    }),
  ),
  http.get(`${API}/ontology/packs`, () => HttpResponse.json(fx.packs)),
  http.post(/\/api\/v1\/ontology\/packs:import$/, () =>
    HttpResponse.json({
      report: {
        apiName: 'supplyChain',
        version: '1.0.0',
        diff: {
          apiName: 'supplyChain',
          fromVersion: null,
          toVersion: '1.0.0',
          breaking: false,
          changes: [],
          suggestedVersion: '1.0.0',
        },
        indexChanges: [],
        publishedAt: fx.NOW,
      },
    }),
  ),

  // --- integration ------------------------------------------------------------
  http.get(`${API}/sources`, () => HttpResponse.json(db.sources)),
  http.get(`${API}/sources/:id`, ({params}) => {
    const s = db.sources.find(x => x.id === params.id);
    return s ? HttpResponse.json(s) : problem(404, 'SOURCE_NOT_FOUND');
  }),
  http.post(`${API}/sources`, async ({request}) => {
    const def = (await request.json()) as Omit<
      SourceDto,
      'id' | 'tenantId' | 'cursor' | 'createdAt'
    >;
    const s: SourceDto = {
      ...def,
      id: `src-${db.sources.length + 1}`,
      tenantId: 't1',
      enabled: def.enabled ?? true,
      cursor: null,
      createdAt: fx.NOW,
    };
    db.sources.push(s);
    return HttpResponse.json(s, {status: 201});
  }),
  http.patch(`${API}/sources/:id`, async ({params, request}) => {
    const s = db.sources.find(x => x.id === params.id);
    if (!s) return problem(404, 'SOURCE_NOT_FOUND');
    Object.assign(s, await request.json());
    return HttpResponse.json(s);
  }),
  http.delete(`${API}/sources/:id`, ({params}) => {
    db.sources = db.sources.filter(x => x.id !== params.id);
    return new HttpResponse(null, {status: 204});
  }),
  http.post(/\/api\/v1\/sources\/[^/]+\/uploads:presign$/, () =>
    HttpResponse.json({
      url: '',
      key: 'raw/t1/file.csv',
      expiresAt: fx.NOW,
      jobId: 'job-new',
    }),
  ),
  http.post(`${API}/sources/:id/batches`, async ({params, request}) => {
    const b = (await request.json()) as {
      jobId?: string;
      seq: number;
      last: boolean;
      records: unknown[];
    };
    db.batches.push({
      sourceId: String(params.id),
      seq: b.seq,
      last: b.last,
      records: b.records.length,
      key: request.headers.get('idempotency-key'),
      jobId: b.jobId,
    });
    return HttpResponse.json(
      {
        jobId: b.jobId ?? 'job-new',
        queuedMessages: Math.ceil(b.records.length / 50),
      },
      {status: 202},
    );
  }),
  http.post(
    /\/api\/v1\/sources\/[^/]+\/mapping:suggest$/,
    async ({request}) => {
      const b = (await request.json()) as {
        fields: string[];
        targetType: string;
      };
      const props =
        fx.compiledModel.objectTypes[b.targetType]?.properties.map(
          p => p.apiName,
        ) ?? [];
      return HttpResponse.json({
        targetType: b.targetType,
        primaryKey: {from: b.fields[0] ?? ''},
        fields: b.fields
          .filter(f => props.includes(f))
          .map(f => ({
            to: f,
            from: f,
            transform: f === 'riskScore' ? 'toNumber' : 'trim',
            confidence: 0.9,
          })),
        model: '@cf/meta/llama-3.1-8b-instruct',
      });
    },
  ),
  http.get(`${API}/jobs`, () => HttpResponse.json(db.jobs)),
  http.get(`${API}/jobs/:id`, ({params}) => {
    const j = db.jobs.find(x => x.id === params.id);
    if (j) return HttpResponse.json(j);
    return HttpResponse.json({
      ...fx.jobs[0],
      id: String(params.id),
      status: 'Succeeded',
      rejected: 0,
      received: 3,
      upserted: 3,
    });
  }),
  http.get(`${API}/jobs/:id/rejected`, ({params}) =>
    HttpResponse.json(db.rejected.filter(r => r.jobId === params.id)),
  ),
  http.post(`${API}/jobs/:id/replay`, async ({request}) => {
    const b = (await request.json().catch(() => ({}))) as {fixes?: unknown[]};
    return HttpResponse.json({requeued: b.fixes?.length ?? db.rejected.length});
  }),
  http.get(`${API}/data-health`, () => HttpResponse.json(fx.dataHealth)),

  // --- objects ------------------------------------------------------------------
  http.get(`${API}/objects/rid/:rid`, ({params, request}) => {
    const o = db.objects.find(x => x.rid === params.rid);
    if (!o) return problem(404, 'OBJECT_NOT_FOUND');
    const url = new URL(request.url);
    const depth = url.searchParams.get('depth') === '1' ? 1 : 2;
    return HttpResponse.json(
      url.searchParams.get('expand') === 'links'
        ? {...o, ...neighborsOf(o, depth)}
        : o,
    );
  }),
  http.get(`${API}/objects/rid/:rid/lineage`, ({params}) => {
    const o = db.objects.find(x => x.rid === params.rid);
    return o
      ? HttpResponse.json(fx.lineageOf(o))
      : problem(404, 'OBJECT_NOT_FOUND');
  }),
  http.get(`${API}/objects/rid/:rid/actions`, ({params}) =>
    HttpResponse.json(fx.actionLog.filter(a => a.targetRid === params.rid)),
  ),
  http.get(`${API}/objects/:type`, ({params, request}) => {
    const url = new URL(request.url);
    const filter = url.searchParams.get('filter');
    const [prop, dir] = (url.searchParams.get('orderBy') ?? '').split(':');
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const offset = Number(url.searchParams.get('cursor') ?? 0);
    let items = db.objects.filter(o => o.type === params.type);
    if (filter)
      items = items.filter(o =>
        matchFilter(JSON.parse(filter) as FilterExpr, o.props),
      );
    if (prop) {
      items = [...items].sort((a, b) => {
        const x = a.props[prop] as number | string;
        const y = b.props[prop] as number | string;
        return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'desc' ? -1 : 1);
      });
    }
    const page = items.slice(offset, offset + limit);
    return HttpResponse.json({
      items: page,
      nextCursor: offset + limit < items.length ? String(offset + limit) : null,
    });
  }),
  http.get(`${API}/object-sets`, () => HttpResponse.json(db.objectSets)),
  http.post(`${API}/object-sets`, async ({request}) => {
    const b = (await request.json()) as Pick<
      ObjectSetDto,
      'name' | 'definition'
    >;
    const s: ObjectSetDto = {
      id: `os-${db.objectSets.length + 1}`,
      name: b.name,
      definition: b.definition,
      createdBy: 'admin',
      updatedAt: fx.NOW,
    };
    db.objectSets.push(s);
    return HttpResponse.json(s, {status: 201});
  }),
  http.post(/\/api\/v1\/object-sets:evaluate$/, async ({request}) => {
    const b = (await request.json()) as {
      definition: {objectType: string; filter?: FilterExpr};
      limit?: number;
    };
    const items = db.objects.filter(
      o =>
        o.type === b.definition.objectType &&
        matchFilter(b.definition.filter, o.props),
    );
    return HttpResponse.json({
      items: items.slice(0, b.limit ?? 50),
      nextCursor: null,
    });
  }),
  http.post(`${API}/object-sets/:id/evaluate`, ({params}) => {
    const s = db.objectSets.find(x => x.id === params.id);
    if (!s) return problem(404, 'NOT_FOUND');
    return HttpResponse.json({
      items: db.objects.filter(
        o =>
          o.type === s.definition.objectType &&
          matchFilter(s.definition.filter, o.props),
      ),
      nextCursor: null,
    });
  }),
  http.get(`${API}/search`, ({request}) => {
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const type = url.searchParams.get('type');
    return HttpResponse.json(
      db.objects
        .filter(
          o =>
            (!type || o.type === type) &&
            (o.title.toLowerCase().includes(q) || o.rid.toLowerCase() === q),
        )
        .slice(0, Number(url.searchParams.get('limit') ?? 10)),
    );
  }),
  http.get(`${API}/graph/impact`, ({request}) => {
    const url = new URL(request.url);
    const root = url.searchParams.get('rid');
    const nodes = db.objects.map(o => ({
      rid: o.rid,
      type: o.type,
      title: o.title,
      props: o.props,
      hop: o.rid === root ? 0 : o.type === 'Material' ? 1 : 2,
    }));
    return HttpResponse.json({nodes, edges: fx.edges, degraded: false});
  }),
  http.get(`${API}/graph/paths`, ({request}) => {
    const url = new URL(request.url);
    const from = url.searchParams.get('from') as Rid;
    const to = url.searchParams.get('to') as Rid;
    return HttpResponse.json({
      paths: [[from, fx.rid('Material', 'M101'), to]],
      degraded: true,
    });
  }),
  http.post(`${API}/actions/:actionType/apply`, async ({params, request}) => {
    const b = (await request.json()) as {
      target: Rid;
      params: Record<string, unknown>;
    };
    const o = db.objects.find(x => x.rid === b.target);
    if (!o) return problem(404, 'OBJECT_NOT_FOUND');
    const ifMatch = request.headers.get('if-match')?.replace(/"/g, '');
    if (ifMatch && Number(ifMatch) !== o.version)
      return problem(412, 'VERSION_CONFLICT');
    const def = fx.actionTypes.find(a => a.apiName === params.actionType);
    if (def?.requiresApproval)
      return problem(409, 'APPROVAL_REQUIRED', 'needs approval', {
        recommendationId: 'rec-1',
      });
    if (o.props.status === 'suspended')
      return problem(422, 'PRECONDITION_FAILED', 'unmet', {
        unmet: ['已停用的供应商不能标记'],
      });
    const before = {...o.props};
    o.version += 1;
    if (params.actionType === 'flagSupplier') o.props.status = 'watch';
    return HttpResponse.json({
      actionLogId: 'al-new',
      actionType: params.actionType,
      rid: o.rid,
      version: o.version,
      before,
      after: o.props,
      writebackStatus: 'NONE',
      executedAt: fx.NOW,
    });
  }),
  http.post(/\/api\/v1\/admin\/graph:rebuild$/, () =>
    HttpResponse.json({queued: 10}),
  ),

  // --- situation ----------------------------------------------------------------
  http.get(`${API}/situation/overview`, () =>
    HttpResponse.json({...fx.overview, alerts: db.alerts}),
  ),
  http.get(`${API}/kpis`, () => HttpResponse.json(fx.kpis)),
  http.get(`${API}/kpis/:id/trend`, ({request}) => {
    const range =
      new URL(request.url).searchParams.get('range') === '7d' ? '7d' : '24h';
    const n = range === '7d' ? 7 * 24 : 24;
    const end = Date.parse(fx.NOW);
    return HttpResponse.json(
      Array.from({length: n}, (_, i) => ({
        ts: new Date(end - (n - 1 - i) * 3_600_000).toISOString(),
        value: 40 + Math.round(Math.sin(i / 4) * 6),
      })),
    );
  }),
  http.get(`${API}/alerts`, ({request}) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const r = url.searchParams.get('rid');
    return HttpResponse.json(
      db.alerts.filter(
        a => (!status || a.status === status) && (!r || a.rid === r),
      ),
    );
  }),
  http.patch(`${API}/alerts/:id`, async ({params, request}) => {
    const a = db.alerts.find(x => x.id === params.id);
    if (!a) return problem(404, 'NOT_FOUND');
    a.status = ((await request.json()) as {status: AlertDto['status']}).status;
    return HttpResponse.json(a);
  }),
  http.get(`${API}/cockpit/layout`, () => HttpResponse.json(fx.layout)),
  http.get(`${API}/automations`, () => HttpResponse.json(db.automations)),
  http.post(`${API}/automations`, async ({request}) => {
    const b = (await request.json()) as AutomationDto;
    const a: AutomationDto = {
      ...b,
      id: `auto-${db.automations.length + 1}`,
      cooldownSec: b.cooldownSec ?? 3600,
      enabled: b.enabled ?? true,
      createdAt: fx.NOW,
    };
    db.automations.push(a);
    return HttpResponse.json(a, {status: 201});
  }),
  http.put(`${API}/automations/:id`, async ({params, request}) => {
    const i = db.automations.findIndex(x => x.id === params.id);
    if (i < 0) return problem(404, 'NOT_FOUND');
    db.automations[i] = {
      ...db.automations[i],
      ...((await request.json()) as AutomationDto),
    };
    return HttpResponse.json(db.automations[i]);
  }),
  http.delete(`${API}/automations/:id`, ({params}) => {
    db.automations = db.automations.filter(x => x.id !== params.id);
    return new HttpResponse(null, {status: 204});
  }),
  http.post(/\/api\/v1\/automations:dry-run$/, () =>
    HttpResponse.json({
      wouldFire: 2,
      sample: [fx.rid('Supplier', 'S002'), fx.rid('Supplier', 'S004')],
    }),
  ),
  http.get(`${API}/usage`, () => HttpResponse.json(fx.usage)),
  http.get(`${API}/admin/usage`, () =>
    HttpResponse.json({...fx.usage, degraded: {neo4j: false, llm: 'gemini'}}),
  ),
  http.get(`${API}/admin/dlq`, ({request}) => {
    const q = new URL(request.url).searchParams.get('queue');
    return HttpResponse.json(fx.deadLetters.filter(d => !q || d.queue === q));
  }),
  http.post(`${API}/admin/dlq/:queue/replay`, () =>
    HttpResponse.json({replayed: 1}),
  ),

  // --- decision -------------------------------------------------------------------
  http.get(`${API}/scenarios`, () => HttpResponse.json(db.scenarios)),
  http.get(`${API}/scenarios/:id`, ({params}) => {
    const s = db.scenarios.find(x => x.id === params.id);
    return s ? HttpResponse.json(s) : problem(404, 'NOT_FOUND');
  }),
  http.post(`${API}/scenarios`, async ({request}) => {
    const b = (await request.json()) as Pick<
      ScenarioDto,
      'name' | 'perturbations'
    >;
    const s: ScenarioDto = {
      id: `sc-${db.scenarios.length + 1}`,
      name: b.name ?? 'Scenario',
      perturbations: b.perturbations,
      createdBy: 'admin',
      createdAt: fx.NOW,
    };
    db.scenarios.push(s);
    return HttpResponse.json(s, {status: 201});
  }),
  http.post(`${API}/scenarios/:id/run`, () =>
    HttpResponse.json(fx.scenarioResult),
  ),
  http.post(/\/api\/v1\/scenarios:run$/, () =>
    HttpResponse.json(fx.scenarioResult),
  ),
  http.post(/\/api\/v1\/scenarios:candidates$/, () =>
    HttpResponse.json([
      {
        actionType: 'switchSupplier',
        displayName: {'zh-CN': '切换供应商', 'en-US': 'Switch supplier'},
        target: fx.rid('Material', 'M101'),
        targetTitle: 'Controller PCB',
        params: {newSupplier: fx.rid('Supplier', 'S003')},
        requiresApproval: true,
        eligible: true,
      },
      {
        actionType: 'increaseSafetyStock',
        displayName: {
          'zh-CN': '提高安全库存',
          'en-US': 'Increase safety stock',
        },
        target: fx.rid('Product', 'P900'),
        targetTitle: 'Edge Gateway X1',
        params: {days: 7},
        requiresApproval: true,
        eligible: true,
      },
      {
        actionType: 'flagSupplier',
        displayName: {'zh-CN': '标记观察', 'en-US': 'Flag supplier'},
        target: fx.rid('Supplier', 'S002'),
        targetTitle: 'Hanoi Circuit Works',
        params: {},
        requiresApproval: false,
        eligible: false,
        unmetPreconditions: ['已停用的供应商不能标记'],
      },
    ]),
  ),
  http.get(`${API}/llm/quota`, () =>
    HttpResponse.json({userRemaining: 17, tenantRemaining: 42}),
  ),
  http.post(/\/api\/v1\/recommendations:generate$/, () =>
    HttpResponse.json({jobId: 'rec-1'}, {status: 202}),
  ),
  http.get(`${API}/recommendations`, ({request}) => {
    const status = new URL(request.url).searchParams.get('status');
    return HttpResponse.json(
      db.recommendations.filter(r => !status || r.status === status),
    );
  }),
  http.get(`${API}/recommendations/:id`, ({params}) => {
    const r = db.recommendations.find(x => x.id === params.id);
    return r ? HttpResponse.json(r) : problem(404, 'NOT_FOUND');
  }),
  http.post(`${API}/recommendations/:id/approve`, ({params}) => {
    const r = db.recommendations.find(x => x.id === params.id);
    if (!r) return problem(404, 'NOT_FOUND');
    if (r.status !== 'Proposed') return problem(409, 'INVALID_TRANSITION');
    r.status = 'Executed';
    r.decidedAt = fx.NOW;
    r.approvedBy = 'admin';
    r.actions = r.actions.map(a => ({
      ...a,
      execution: {status: 'Executed', actionLogId: 'al-x'},
    }));
    return HttpResponse.json(r);
  }),
  http.post(`${API}/recommendations/:id/reject`, async ({params, request}) => {
    const r = db.recommendations.find(x => x.id === params.id);
    if (!r) return problem(404, 'NOT_FOUND');
    r.status = 'Rejected';
    r.rejectReason = ((await request.json()) as {reason: string}).reason;
    return HttpResponse.json(r);
  }),
  http.post(
    `${API}/recommendations/:id/feedback`,
    async ({params, request}) => {
      const r = db.recommendations.find(x => x.id === params.id);
      if (!r) return problem(404, 'NOT_FOUND');
      r.feedback = (await request.json()) as {rating: number; comment?: string};
      return HttpResponse.json(r);
    },
  ),
];
