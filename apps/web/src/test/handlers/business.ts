/**
 * @fileoverview MSW handlers for business endpoints: ontology, imports,
 * objects, situation, automations, scenarios, recommendations. Backed by a
 * resettable in-memory db built from the contract fixtures; ETags,
 * If-Match (412), Idempotency-Key replay and seq-idempotent batches behave
 * like the gateway. Tests inspect {@link businessDb} and override single
 * endpoints with `server.use(...)`.
 */

import type {
  RecommendationDto,
  ScenarioDto,
  ScenarioInput,
} from '@ontodecide/decision/contract';
import type {
  BatchInput,
  BatchResult,
  CreateImportInput,
  JobDto,
  MappingDraft,
  MappingDraftInput,
  MappingSpec,
} from '@ontodecide/integration/contract';
import type {
  ActionLogDto,
  GraphEdge,
  GraphNode,
  ObjectDto,
} from '@ontodecide/object-graph/contract';
import type {
  DefKind,
  OntologyDef,
  OntologyDto,
} from '@ontodecide/ontology/contract';
import {
  type FilterExpr,
  matchFilter,
  parseEtag,
  toEtag,
} from '@ontodecide/shared-kernel';
import type {
  AlertDto,
  AutomationDef,
  AutomationDto,
} from '@ontodecide/situation/contract';
import {http, HttpResponse, type HttpHandler} from 'msw';
import {
  makeActionLog,
  makeAlerts,
  makeAutomations,
  makeJobs,
  makeLinks,
  makeObjects,
  makeOverview,
  makeQuotas,
  makeRecommendations,
  makeScenario,
  ontologyDto,
} from '../fixtures/business';
import {API, problem} from './problem';

/** Recorded request (for assertions). */
export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

function freshDb() {
  return {
    ontology: structuredClone(ontologyDto) as OntologyDto,
    objects: makeObjects(),
    links: makeLinks(),
    actionLog: makeActionLog(),
    overview: makeOverview(),
    alerts: makeAlerts(),
    automations: makeAutomations(),
    recommendations: makeRecommendations(),
    scenarios: [makeScenario()] as ScenarioDto[],
    quotas: makeQuotas(),
    jobs: makeJobs(),
    /** Batches received per job: seq → result. */
    batches: new Map<string, Map<number, BatchResult>>(),
    /** Rows received per job (all batches). */
    batchRows: new Map<string, number>(),
    idempotency: new Map<string, unknown>(),
    sampleLoaded: false,
    requests: [] as RecordedRequest[],
    seq: 1000,
  };
}

/** In-memory state (reset after each test). */
export let businessDb = freshDb();

/** Resets the business in-memory state between tests. */
export function resetBusinessDb(): void {
  businessDb = freshDb();
}

function json(body: unknown, init: {status?: number; version?: number} = {}) {
  return HttpResponse.json(body as never, {
    status: init.status ?? 200,
    headers:
      init.version !== undefined ? {etag: toEtag(init.version)} : undefined,
  });
}

async function record(request: Request): Promise<unknown> {
  let body: unknown;
  try {
    const text = await request.clone().text();
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => (headers[k] = v));
  businessDb.requests.push({
    method: request.method,
    path: new URL(request.url).pathname.replace(/^\/api\/v1/, ''),
    headers,
    body,
  });
  return body;
}

function ifMatch(request: Request): number | null {
  return parseEtag(request.headers.get('if-match'));
}

function page<T>(items: T[], url: URL) {
  const limit = Math.min(100, Number(url.searchParams.get('limit') ?? 50));
  const offset = Number(url.searchParams.get('cursor') ?? 0);
  const slice = items.slice(offset, offset + limit);
  const next = offset + limit < items.length ? String(offset + limit) : null;
  return {items: slice, nextCursor: next};
}

function nextId(prefix: string): string {
  businessDb.seq += 1;
  return `${prefix}-${businessDb.seq}`;
}

function title(o: ObjectDto): string {
  return o.title;
}

function graphAround(root: ObjectDto, depth: number, types?: string[]) {
  const byRid = new Map(businessDb.objects.map(o => [o.rid, o] as const));
  const hop = new Map<string, number>([[root.rid, 0]]);
  const edges: GraphEdge[] = [];
  let frontier = [root.rid as string];
  for (let d = 1; d <= depth; d++) {
    const next: string[] = [];
    for (const l of businessDb.links) {
      if (types?.length && !types.includes(l.type)) continue;
      for (const r of frontier) {
        if (l.src !== r && l.dst !== r) continue;
        if (!edges.includes(l)) edges.push(l);
        const other = l.src === r ? l.dst : l.src;
        if (!hop.has(other)) {
          hop.set(other, d);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  const nodes: GraphNode[] = [...hop].flatMap(([r, h]) => {
    const o = byRid.get(r as ObjectDto['rid']);
    return o
      ? [{rid: o.rid, type: o.type, title: title(o), props: o.props, hop: h}]
      : [];
  });
  return {nodes, edges, truncated: false};
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a ?? '').localeCompare(String(b ?? ''));
}

const ontologyHandlers: HttpHandler[] = [
  http.get(`${API}/ontology`, () =>
    json(businessDb.ontology, {version: businessDb.ontology.etag}),
  ),
  ...(['object-types', 'link-types', 'action-types'] as DefKind[]).flatMap(
    kind => {
      const field: Record<DefKind, keyof OntologyDef> = {
        'object-types': 'objectTypes',
        'link-types': 'linkTypes',
        'action-types': 'actionTypes',
      };
      const list = () =>
        businessDb.ontology.definition[field[kind]] as {apiName: string}[];
      const bump = () => {
        const o = businessDb.ontology;
        o.etag += 1;
        o.custom = true;
        o.updatedAt = new Date().toISOString();
        return o.etag;
      };
      const write = async (request: Request, id?: string) => {
        const body = (await record(request)) as {apiName: string};
        const m = ifMatch(request);
        if (m === null) return problem(428, 'PRECONDITION_FAILED', 'If-Match');
        if (m !== businessDb.ontology.etag)
          return problem(412, 'PRECONDITION_FAILED');
        if (!body?.apiName) return problem(400, 'VALIDATION_FAILED');
        const items = list();
        const key = id ?? body.apiName;
        const i = items.findIndex(d => d.apiName === key);
        if (!id && i >= 0) return problem(409, 'CONFLICT', 'exists');
        if (i >= 0) items[i] = body;
        else items.push(body);
        const etag = bump();
        return json({etag}, {status: id ? 200 : 201, version: etag});
      };
      return [
        http.get(`${API}/${kind}`, () =>
          json(
            {
              items: list(),
              etag: businessDb.ontology.etag,
              custom: businessDb.ontology.custom,
            },
            {version: businessDb.ontology.etag},
          ),
        ),
        http.post(`${API}/${kind}`, ({request}) => write(request)),
        http.put(`${API}/${kind}/:id`, ({request, params}) =>
          write(request, String(params.id)),
        ),
        http.delete(`${API}/${kind}/:id`, async ({request, params}) => {
          await record(request);
          if (ifMatch(request) !== businessDb.ontology.etag)
            return problem(412, 'PRECONDITION_FAILED');
          const items = list();
          const i = items.findIndex(d => d.apiName === params.id);
          if (i < 0) return problem(404, 'NOT_FOUND');
          items.splice(i, 1);
          const etag = bump();
          return json({etag}, {version: etag});
        }),
      ];
    },
  ),
];

const objectHandlers: HttpHandler[] = [
  http.get(`${API}/objects/stats`, () => {
    const byType: Record<string, number> = {};
    for (const o of businessDb.objects)
      byType[o.type] = (byType[o.type] ?? 0) + 1;
    return json({
      objects: businessDb.objects.length,
      links: businessDb.links.length,
      byType,
    });
  }),
  http.get(`${API}/objects`, ({request}) => {
    const url = new URL(request.url);
    const type = url.searchParams.get('type');
    const q = url.searchParams.get('q')?.toLowerCase();
    const filterRaw = url.searchParams.get('filter');
    const orderBy = url.searchParams.get('orderBy');
    let items = businessDb.objects.filter(o => !type || o.type === type);
    if (q)
      items = items.filter(
        o =>
          o.title.toLowerCase().includes(q) ||
          o.primaryKey.toLowerCase().includes(q) ||
          o.rid.toLowerCase() === q,
      );
    if (filterRaw) {
      const f = JSON.parse(filterRaw) as FilterExpr;
      items = items.filter(o => matchFilter(f, o.props));
    }
    if (orderBy) {
      const [prop, dir] = orderBy.split(':');
      items = [...items].sort(
        (a, b) =>
          compare(a.props[prop], b.props[prop]) * (dir === 'desc' ? -1 : 1),
      );
    }
    return json(page(items, url));
  }),
  http.get(`${API}/objects/:rid`, ({params}) => {
    const o = businessDb.objects.find(x => x.rid === params.rid);
    if (!o) return problem(404, 'NOT_FOUND');
    return json(o, {version: o.version});
  }),
  http.patch(`${API}/objects/:rid`, async ({request, params}) => {
    const patch = (await record(request)) as Record<string, unknown>;
    const o = businessDb.objects.find(x => x.rid === params.rid);
    if (!o) return problem(404, 'NOT_FOUND');
    if (!request.headers.get('content-type')?.includes('merge-patch'))
      return problem(400, 'VALIDATION_FAILED', 'content-type');
    if (ifMatch(request) !== o.version)
      return problem(412, 'PRECONDITION_FAILED');
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete o.props[k];
      else o.props[k] = v;
    }
    o.version += 1;
    o.updatedAt = new Date().toISOString();
    return json(o, {version: o.version});
  }),
  http.get(`${API}/objects/:rid/links`, ({request, params}) => {
    const url = new URL(request.url);
    const o = businessDb.objects.find(x => x.rid === params.rid);
    if (!o) return problem(404, 'NOT_FOUND');
    const depth = Number(url.searchParams.get('depth') ?? 1);
    const types = url.searchParams.get('linkTypes')?.split(',').filter(Boolean);
    return json(graphAround(o, Math.min(2, depth), types));
  }),
  http.get(`${API}/objects/:rid/actions`, ({params}) =>
    json({
      items: businessDb.actionLog.filter(a => a.targetRid === params.rid),
      nextCursor: null,
    }),
  ),
  http.post(`${API}/action-types/:id/executions`, async ({request, params}) => {
    const body = (await record(request)) as {
      target: string;
      params: Record<string, unknown>;
    };
    const key = request.headers.get('idempotency-key');
    if (!key || key.length < 16)
      return problem(400, 'VALIDATION_FAILED', 'Idempotency-Key');
    const seen = businessDb.idempotency.get(`exec:${key}`);
    if (seen) return json({...(seen as object), replayed: true});
    const o = businessDb.objects.find(x => x.rid === body.target);
    if (!o) return problem(404, 'NOT_FOUND');
    if (ifMatch(request) !== o.version)
      return problem(412, 'PRECONDITION_FAILED');
    const before = {...o.props};
    o.version += 1;
    const entry: ActionLogDto = {
      id: nextId('al'),
      actionType: String(params.id),
      targetRid: o.rid,
      params: body.params ?? {},
      before,
      after: {...o.props},
      actor: 'owner',
      executedAt: new Date().toISOString(),
    };
    businessDb.actionLog.unshift(entry);
    const result = {
      actionLogId: entry.id,
      actionType: entry.actionType,
      rid: o.rid,
      version: o.version,
      before,
      after: entry.after,
      executedAt: entry.executedAt,
      replayed: false,
    };
    businessDb.idempotency.set(`exec:${key}`, result);
    return json(result);
  }),
];

function patchAlert(
  id: string,
  patch: Partial<AlertDto>,
): AlertDto | undefined {
  const a = businessDb.alerts.find(x => x.id === id);
  if (!a) return undefined;
  Object.assign(a, patch);
  const o = businessDb.overview.alerts.find(x => x.id === id);
  if (o) Object.assign(o, patch);
  return a;
}

function scheduledCount(exceptId?: string): number {
  return businessDb.automations.filter(
    a => a.trigger === 'schedule' && a.id !== exceptId,
  ).length;
}

function checkAutomation(def: AutomationDef, exceptId?: string) {
  if (def.trigger === 'schedule') {
    if (!def.everyHours || def.everyHours < 1)
      return problem(400, 'VALIDATION_FAILED', 'everyHours');
    if (scheduledCount(exceptId) >= 3)
      return problem(400, 'VALIDATION_FAILED', 'max 3 scheduled');
  }
  return null;
}

const situationHandlers: HttpHandler[] = [
  http.get(`${API}/situation/overview`, () =>
    json({
      ...businessDb.overview,
      alerts: businessDb.overview.alerts,
      pendingRecommendations: businessDb.recommendations
        .filter(r => r.status === 'Proposed')
        .slice(0, 5),
      quotas: businessDb.quotas,
    }),
  ),
  http.get(`${API}/alerts`, ({request}) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const severity = url.searchParams.get('severity');
    const r = url.searchParams.get('rid');
    const items = businessDb.alerts.filter(
      a =>
        (!status || a.status === status) &&
        (!severity || a.severity === severity) &&
        (!r || a.rid === r),
    );
    return json(page(items, url));
  }),
  http.post(`${API}/alerts/:id/acknowledgement`, async ({request, params}) => {
    await record(request);
    const a = patchAlert(String(params.id), {
      status: 'ACKED',
      ackedAt: new Date().toISOString(),
    });
    return a ? json(a) : problem(404, 'NOT_FOUND');
  }),
  http.post(`${API}/workspace/sample-data`, async ({request}) => {
    await record(request);
    if (businessDb.sampleLoaded) return problem(409, 'CONFLICT', 'loaded');
    businessDb.sampleLoaded = true;
    const job: JobDto = {
      ...makeJobs()[1],
      id: nextId('imp'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    businessDb.jobs.unshift(job);
    return json(job, {status: 202});
  }),
  http.get(`${API}/automations`, () => json(businessDb.automations)),
  http.post(`${API}/automations`, async ({request}) => {
    const def = (await record(request)) as AutomationDef;
    const bad = checkAutomation(def);
    if (bad) return bad;
    const a: AutomationDto = {
      ...def,
      id: nextId('auto'),
      version: 1,
      nextRunAt: null,
      lastFiredAt: null,
    };
    businessDb.automations.push(a);
    return json(a, {status: 201, version: 1});
  }),
  http.get(`${API}/automations/:id`, ({params}) => {
    const a = businessDb.automations.find(x => x.id === params.id);
    return a ? json(a, {version: a.version}) : problem(404, 'NOT_FOUND');
  }),
  http.put(`${API}/automations/:id`, async ({request, params}) => {
    const def = (await record(request)) as AutomationDef;
    const a = businessDb.automations.find(x => x.id === params.id);
    if (!a) return problem(404, 'NOT_FOUND');
    if (ifMatch(request) !== a.version)
      return problem(412, 'PRECONDITION_FAILED');
    const bad = checkAutomation(def, a.id);
    if (bad) return bad;
    const {everyHours: _e, ...base} = a;
    const next: AutomationDto = {
      ...base,
      ...def,
      id: a.id,
      version: a.version + 1,
      nextRunAt: a.nextRunAt,
      lastFiredAt: a.lastFiredAt,
    };
    businessDb.automations[businessDb.automations.indexOf(a)] = next;
    return json(next, {version: next.version});
  }),
  http.delete(`${API}/automations/:id`, async ({request, params}) => {
    await record(request);
    const i = businessDb.automations.findIndex(x => x.id === params.id);
    if (i < 0) return problem(404, 'NOT_FOUND');
    if (ifMatch(request) !== businessDb.automations[i].version)
      return problem(412, 'PRECONDITION_FAILED');
    businessDb.automations.splice(i, 1);
    return new HttpResponse(null, {status: 204});
  }),
];

const decisionHandlers: HttpHandler[] = [
  http.post(`${API}/scenarios`, async ({request}) => {
    const input = (await record(request)) as ScenarioInput;
    if (!input?.perturbations?.length || input.perturbations.length > 10)
      return problem(400, 'VALIDATION_FAILED', 'perturbations');
    const base = makeScenario();
    const s: ScenarioDto = {
      ...base,
      id: nextId('scn'),
      name: input.name ?? base.name,
      perturbations: input.perturbations,
      createdAt: new Date().toISOString(),
    };
    businessDb.scenarios.push(s);
    return json(s, {status: 201});
  }),
  http.get(`${API}/scenarios/:id`, ({params}) => {
    const s = businessDb.scenarios.find(x => x.id === params.id);
    return s ? json(s) : problem(404, 'NOT_FOUND');
  }),
  http.get(`${API}/recommendations`, ({request}) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    return json(
      page(
        businessDb.recommendations.filter(r => !status || r.status === status),
        url,
      ),
    );
  }),
  http.get(`${API}/recommendations/:id`, ({params}) => {
    const r = businessDb.recommendations.find(x => x.id === params.id);
    return r ? json(r, {version: r.version}) : problem(404, 'NOT_FOUND');
  }),
  http.post(`${API}/recommendations`, async ({request}) => {
    const input = (await record(request)) as {
      focus: string;
      scenarioId?: string;
    };
    const q = businessDb.quotas.aiRecsToday;
    const ai = q.used < q.limit;
    if (ai) q.used += 1;
    const base = makeRecommendations()[0];
    const rec: RecommendationDto = {
      ...base,
      id: nextId('rec'),
      focus: input.focus as RecommendationDto['focus'],
      scenarioId: input.scenarioId,
      rankedBy: ai ? 'ai' : 'rules',
      model: ai ? base.model : undefined,
      createdAt: new Date().toISOString(),
    };
    businessDb.recommendations.unshift(rec);
    return json(rec, {status: 201, version: rec.version});
  }),
  http.post(
    `${API}/recommendations/:id/decision`,
    async ({request, params}) => {
      const body = (await record(request)) as {
        decision: string;
        reason?: string;
      };
      const key = request.headers.get('idempotency-key');
      if (!key || key.length < 16)
        return problem(400, 'VALIDATION_FAILED', 'Idempotency-Key');
      const seen = businessDb.idempotency.get(`dec:${key}`);
      if (seen) return json(seen);
      const r = businessDb.recommendations.find(x => x.id === params.id);
      if (!r) return problem(404, 'NOT_FOUND');
      if (r.status !== 'Proposed') return problem(409, 'CONFLICT');
      if (body.decision === 'reject' && !body.reason)
        return problem(400, 'VALIDATION_FAILED', 'reason');
      if (body.decision === 'confirm') {
        r.status = 'Executed';
        r.execution = [
          {
            candidateId: r.ranking[0],
            status: 'Executed',
            actionLogId: nextId('al'),
          },
        ];
      } else {
        r.status = 'Rejected';
        r.rejectReason = body.reason;
      }
      r.decidedBy = 'owner';
      r.decidedAt = new Date().toISOString();
      r.version += 1;
      businessDb.idempotency.set(`dec:${key}`, structuredClone(r));
      return json(r, {version: r.version});
    },
  ),
];

function draftFor(input: MappingDraftInput): MappingDraft {
  const t = businessDb.ontology.definition.objectTypes.find(
    o => o.apiName === input.targetType,
  );
  const props = t?.properties.map(p => p.apiName) ?? [];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const fields: MappingSpec['fields'] = [];
  const unmatched: string[] = [];
  for (const f of input.fields) {
    const exact = props.find(p => norm(p) === norm(f));
    if (exact) fields.push({to: exact, from: f, matchedBy: 'exact'});
    else unmatched.push(f);
  }
  const q = businessDb.quotas.mappingDraftsToday;
  const ai = q.used < q.limit;
  if (ai) {
    q.used += 1;
    for (const f of [...unmatched]) {
      const guess = props.find(
        p =>
          norm(f).includes(norm(p).slice(0, 3)) &&
          !fields.some(x => x.to === p),
      );
      if (guess) {
        fields.push({to: guess, from: f, matchedBy: 'ai'});
        unmatched.splice(unmatched.indexOf(f), 1);
      }
    }
  }
  return {
    targetType: input.targetType,
    primaryKey: {
      from: fields.find(x => x.to === t?.primaryKey)?.from ?? input.fields[0],
    },
    fields,
    rankedBy: ai ? 'ai' : 'rules',
    unmatched,
  };
}

const integrationHandlers: HttpHandler[] = [
  http.get(`${API}/imports`, ({request}) =>
    json(page(businessDb.jobs, new URL(request.url))),
  ),
  http.post(`${API}/imports`, async ({request}) => {
    const input = (await record(request)) as CreateImportInput;
    const q = businessDb.quotas.importRowsToday;
    if (!input?.totalRows || input.totalRows > 2000)
      return problem(400, 'VALIDATION_FAILED', 'totalRows');
    if (q.used + input.totalRows > q.limit)
      return problem(429, 'QUOTA_EXCEEDED', 'importRowsToday', {
        resetsAt: businessDb.quotas.resetsAt,
      });
    q.used += input.totalRows;
    const now = new Date().toISOString();
    const job: JobDto = {
      id: nextId('imp'),
      kind: 'file',
      fileName: input.fileName,
      targetType: input.targetType,
      mapping: input.mapping ?? null,
      status: 'RECEIVING',
      totalRows: input.totalRows,
      received: 0,
      upserted: 0,
      skipped: 0,
      rejected: 0,
      createdAt: now,
      updatedAt: now,
    };
    businessDb.jobs.unshift(job);
    return json(job, {status: 201});
  }),
  http.get(`${API}/imports/:id`, ({params}) => {
    const j = businessDb.jobs.find(x => x.id === params.id);
    return j ? json(j) : problem(404, 'NOT_FOUND');
  }),
  http.put(`${API}/imports/:id/mapping`, async ({request, params}) => {
    const body = (await record(request)) as {mapping: MappingSpec};
    const j = businessDb.jobs.find(x => x.id === params.id);
    if (!j) return problem(404, 'NOT_FOUND');
    if (businessDb.batches.get(j.id)?.size) return problem(409, 'CONFLICT');
    j.mapping = body.mapping;
    return json(j);
  }),
  http.post(`${API}/imports/:id/mapping-draft`, async ({request, params}) => {
    const input = (await record(request)) as MappingDraftInput;
    const j = businessDb.jobs.find(x => x.id === params.id);
    if (!j) return problem(404, 'NOT_FOUND');
    return json(draftFor(input));
  }),
  http.post(`${API}/imports/:id/batches`, async ({request, params}) => {
    const batch = (await record(request)) as BatchInput;
    const j = businessDb.jobs.find(x => x.id === params.id);
    if (!j) return problem(404, 'NOT_FOUND');
    if (!j.mapping) return problem(409, 'CONFLICT', 'mapping');
    if (batch.rows.length > 100)
      return problem(400, 'VALIDATION_FAILED', 'rows');
    const seen = businessDb.batches.get(j.id) ?? new Map<number, BatchResult>();
    businessDb.batches.set(j.id, seen);
    const replay = seen.get(batch.seq);
    if (replay) return json(replay);
    const pk = j.mapping.primaryKey.from;
    const rejected = batch.rows.flatMap((r, i) =>
      r[pk] === undefined || r[pk] === null || r[pk] === ''
        ? [{row: batch.seq * 100 + i + 1, code: 'REQUIRED', column: pk}]
        : [],
    );
    const upserted = batch.rows.length - rejected.length;
    j.received += batch.rows.length;
    j.upserted += upserted;
    j.rejected += rejected.length;
    j.rejects = [...(j.rejects ?? []), ...rejected].slice(0, 200);
    if (batch.last) j.status = 'DONE';
    j.updatedAt = new Date().toISOString();
    businessDb.batchRows.set(
      j.id,
      (businessDb.batchRows.get(j.id) ?? 0) + batch.rows.length,
    );
    const result: BatchResult = {
      seq: batch.seq,
      upserted,
      skipped: 0,
      rejected,
      job: {
        status: j.status,
        received: j.received,
        upserted: j.upserted,
        skipped: j.skipped,
        rejected: j.rejected,
      },
    };
    seen.set(batch.seq, result);
    return json(result);
  }),
];

/** Business handlers. */
export const businessHandlers: HttpHandler[] = [
  ...ontologyHandlers,
  ...objectHandlers,
  ...situationHandlers,
  ...decisionHandlers,
  ...integrationHandlers,
];
