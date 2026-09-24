/**
 * @fileoverview The declarative public route table (ARCHITECTURE.md §4).
 * One entry per endpoint; new endpoints are new entries only.
 */

import type {
  AutomationDef,
  CockpitLayout,
  KpiDef,
} from '@ontodecide/situation/contract';
import {
  automationDefSchema,
  cockpitLayoutSchema,
  kpiDefSchema,
  replayDlqInputSchema,
  updateAlertInputSchema,
} from '@ontodecide/situation/contract';
import type {
  Perturbation,
  RecStatus,
  ScenarioInput,
} from '@ontodecide/decision/contract';
import {
  candidateActionsInputSchema,
  feedbackInputSchema,
  generateRecommendationInputSchema,
  rejectInputSchema,
  runScenarioInputSchema,
  scenarioInputSchema,
  suggestMappingInputSchema,
} from '@ontodecide/decision/contract';
import {
  changePasswordInputSchema,
  createUserInputSchema,
  grantMarkingInputSchema,
  loginInputSchema,
  updateMeInputSchema,
  updateUserInputSchema,
} from '@ontodecide/identity/contract';
import type {SourceDef} from '@ontodecide/integration/contract';
import {
  batchInputSchema,
  presignInputSchema,
  replayInputSchema,
  sourceDefSchema,
} from '@ontodecide/integration/contract';
import type {ApplyActionCmd} from '@ontodecide/object-graph/contract';
import {
  applyActionInputSchema,
  filterExprSchema,
  objectSetDefSchema,
  pageInputSchema,
  resolveMergeInputSchema,
  saveObjectSetInputSchema,
} from '@ontodecide/object-graph/contract';
import type {SchemaDef} from '@ontodecide/ontology/contract';
import {
  importPackInputSchema,
  publishInputSchema,
  schemaDefSchema,
} from '@ontodecide/ontology/contract';
import {
  AppError,
  type FilterExpr,
  type ObjectSetDef,
  type Rid,
} from '@ontodecide/shared-kernel';
import {z} from 'zod';
import {login, logout, refresh} from './auth_handlers';
import {importPackBff, overviewBff, publishBff, suggestMappingBff} from './bff';
import {
  forwardStream,
  getConfig,
  health,
  telemetry,
  webhook,
} from './gateway_handlers';
import {buildOpenApi} from './openapi';
import {route, type AnyRoute} from './route_types';

// ---------------------------------------------------------------------------
// Query parameter schemas (string inputs, coerced).

const limitQ = z.coerce.number().int().min(1).max(200).optional();
const ridQ = z.string().startsWith('ri.');
const csv = (item: z.ZodString, max: number) =>
  z
    .string()
    .transform(s =>
      s
        .split(',')
        .map(p => p.trim())
        .filter(Boolean),
    )
    .pipe(z.array(item).min(1).max(max));

const jsonParam = z.string().transform((s, c) => {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    c.addIssue({code: 'custom', message: 'Must be valid JSON'});
    return z.NEVER;
  }
});

const orderByParam = z
  .string()
  .regex(
    /^[A-Za-z_]\w*(:(asc|desc))?(,[A-Za-z_]\w*(:(asc|desc))?)*$/,
    'Expected prop:asc|desc[,…]',
  )
  .transform(s =>
    s.split(',').map(part => {
      const [prop, dir] = part.split(':');
      return {prop, dir: (dir ?? 'asc') as 'asc' | 'desc'};
    }),
  );

const versionQuery = z.object({version: z.string().max(32).optional()});
const jobsQuery = z.object({sourceId: z.string().optional(), limit: limitQ});
const listObjectsQuery = z.object({
  filter: jsonParam.pipe(filterExprSchema).optional(),
  orderBy: orderByParam.optional(),
  cursor: z.string().max(1024).optional(),
  limit: limitQ,
});
const getObjectQuery = z.object({
  expand: z.enum(['links']).optional(),
  depth: z.coerce.number().int().min(1).max(2).optional(),
});
const limitQuery = z.object({limit: limitQ});
const searchQuery = z.object({
  q: z.string().min(1).max(200),
  type: z.string().optional(),
  limit: limitQ,
});
const impactQuery = z.object({
  rid: csv(ridQ, 50),
  maxHops: z.coerce.number().int().min(1).max(3).default(2),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  linkTypes: csv(z.string(), 50).optional(),
});
const pathsQuery = z.object({
  from: ridQ,
  to: ridQ,
  maxHops: z.coerce.number().int().min(1).max(6).optional(),
});
const trendQuery = z.object({range: z.enum(['24h', '7d']).default('24h')});
const alertsQuery = z.object({
  status: z.enum(['OPEN', 'ACKED', 'CLOSED']).optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  rid: ridQ.optional(),
  limit: limitQ,
});
const dlqQuery = z.object({queue: z.string().max(64).optional()});
const REC_STATUSES = [
  'Draft',
  'Proposed',
  'Approved',
  'Rejected',
  'Expired',
  'Executed',
  'ExecFailed',
  'Evaluated',
  'Failed',
] as const satisfies readonly RecStatus[];
const recommendationsQuery = z.object({
  status: z.enum(REC_STATUSES).optional(),
  focus: ridQ.optional(),
  limit: limitQ,
});
const streamQuery = z.object({
  access_token: z.string().optional(),
  lastSeq: z.coerce.number().int().min(0).optional(),
});

// ---------------------------------------------------------------------------
// Body schemas composed at the edge.

const pageFields = {
  cursor: z.string().max(1024).optional(),
  limit: z.number().int().min(1).max(200).optional(),
};
const evaluateObjectSetBody = z.union([
  z.object({definition: objectSetDefSchema, ...pageFields}),
  objectSetDefSchema.extend(pageFields),
]);
const saveObjectSetBody = saveObjectSetInputSchema.extend({
  id: z.string().optional(),
});
const updateSourceBody = sourceDefSchema.partial();
const telemetryBody = z.union([
  z.record(z.string(), z.unknown()),
  z.array(z.record(z.string(), z.unknown())).min(1).max(100),
]);

/** Parses an `If-Match` header (`3`, `"3"` or `W/"3"`). */
export function parseIfMatch(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const m = /^(?:W\/)?"?(\d+)"?$/.exec(value.trim());
  if (!m) {
    throw new AppError('VALIDATION_FAILED', 'If-Match must be a version', {
      errors: [{path: 'If-Match', message: 'Expected an integer version'}],
    });
  }
  return Number(m[1]);
}

// ---------------------------------------------------------------------------
// The table.

let openApiCache: {version: string; doc: unknown} | undefined;

/** Every public endpoint, in ARCHITECTURE.md §4 order. */
export const ROUTES: AnyRoute[] = [
  // -- Identity -------------------------------------------------------------
  route({
    method: 'POST',
    path: '/auth/login',
    service: 'IDENTITY',
    minRole: 'public',
    body: loginInputSchema,
    rateGroup: 'auth',
    critical: true,
    summary: 'Password login; sets the refresh cookie',
    handler: login,
  }),
  route({
    method: 'POST',
    path: '/auth/refresh',
    service: 'IDENTITY',
    minRole: 'cookie',
    rateGroup: 'auth',
    critical: true,
    summary: 'Rotates the refresh cookie and issues an access token',
    handler: refresh,
  }),
  route({
    method: 'POST',
    path: '/auth/logout',
    service: 'IDENTITY',
    minRole: 'cookie',
    rateGroup: 'auth',
    critical: true,
    status: 204,
    summary: 'Revokes the refresh token and clears the cookie',
    handler: logout,
  }),
  route({
    method: 'GET',
    path: '/me',
    service: 'IDENTITY',
    minRole: 'Viewer',
    summary: 'Current user',
    handler: (env, {ctx}) => env.IDENTITY.me(ctx),
  }),
  route({
    method: 'PATCH',
    path: '/me',
    service: 'IDENTITY',
    minRole: 'Viewer',
    body: updateMeInputSchema,
    critical: true,
    summary: 'Updates the current user profile',
    handler: (env, {ctx, body}) => env.IDENTITY.updateMe(ctx, body),
  }),
  route({
    method: 'POST',
    path: '/me/password',
    service: 'IDENTITY',
    minRole: 'Viewer',
    body: changePasswordInputSchema,
    rateGroup: 'auth',
    critical: true,
    summary: 'Changes the current user password',
    handler: (env, {ctx, body}) => env.IDENTITY.changePassword(ctx, body),
  }),
  route({
    method: 'GET',
    path: '/users',
    service: 'IDENTITY',
    minRole: 'Admin',
    summary: 'Lists users',
    handler: (env, {ctx}) => env.IDENTITY.listUsers(ctx),
  }),
  route({
    method: 'POST',
    path: '/users',
    service: 'IDENTITY',
    minRole: 'Admin',
    body: createUserInputSchema,
    idempotent: true,
    summary: 'Creates a user',
    handler: (env, {ctx, body}) => env.IDENTITY.createUser(ctx, body),
  }),
  route({
    method: 'PATCH',
    path: '/users/:id',
    service: 'IDENTITY',
    minRole: 'Admin',
    body: updateUserInputSchema,
    summary: 'Updates a user',
    handler: (env, {ctx, params, body}) =>
      env.IDENTITY.updateUser(ctx, params.id, body),
  }),
  route({
    method: 'DELETE',
    path: '/users/:id',
    service: 'IDENTITY',
    minRole: 'Admin',
    summary: 'Deletes a user',
    handler: (env, {ctx, params}) => env.IDENTITY.deleteUser(ctx, params.id),
  }),
  route({
    method: 'POST',
    path: '/users/:id/markings',
    service: 'IDENTITY',
    minRole: 'Admin',
    body: grantMarkingInputSchema,
    summary: 'Sets the markings of a user',
    handler: (env, {ctx, params, body}) =>
      env.IDENTITY.grantMarking(ctx, params.id, body.markings),
  }),
  route({
    method: 'POST',
    path: '/users/:id/password:reset',
    service: 'IDENTITY',
    minRole: 'Admin',
    summary: 'Resets a user password; returns a temporary password',
    handler: (env, {ctx, params}) => env.IDENTITY.resetPassword(ctx, params.id),
  }),

  // -- Ontology -------------------------------------------------------------
  route({
    method: 'GET',
    path: '/ontology/schemas',
    service: 'ONTOLOGY',
    minRole: 'Viewer',
    summary: 'Lists schemas',
    handler: (env, {ctx}) => env.ONTOLOGY.listSchemas(ctx),
  }),
  route({
    method: 'GET',
    path: '/ontology/schemas/:api',
    service: 'ONTOLOGY',
    minRole: 'Viewer',
    query: versionQuery,
    summary: 'Gets a schema version (semver, current or draft)',
    handler: (env, {ctx, params, query}) =>
      env.ONTOLOGY.getSchema(ctx, params.api, query.version),
  }),
  route({
    method: 'GET',
    path: '/ontology/model',
    service: 'ONTOLOGY',
    minRole: 'Viewer',
    summary: 'Active compiled model of the tenant',
    handler: (env, {ctx}) => env.ONTOLOGY.getActiveModel(ctx),
  }),
  route({
    method: 'PUT',
    path: '/ontology/schemas/:api/draft',
    service: 'ONTOLOGY',
    minRole: 'Modeler',
    body: schemaDefSchema,
    summary: 'Saves the draft of a schema',
    handler: (env, {ctx, params, body}) =>
      env.ONTOLOGY.saveDraft(ctx, params.api, body as SchemaDef),
  }),
  route({
    method: 'POST',
    path: '/ontology/schemas/:api/diff',
    service: 'ONTOLOGY',
    minRole: 'Modeler',
    rateGroup: 'read',
    summary: 'Diffs the draft against the current version',
    handler: (env, {ctx, params}) => env.ONTOLOGY.diff(ctx, params.api),
  }),
  route({
    method: 'POST',
    path: '/ontology/schemas/:api/publish',
    service: 'ONTOLOGY',
    minRole: 'Modeler',
    body: publishInputSchema,
    idempotent: true,
    summary:
      'BFF: publishes the draft, reindexes objects and pauses affected sources on breaking changes',
    handler: (env, {ctx, params, body}) =>
      publishBff(env, ctx, params.api, body),
  }),
  route({
    method: 'GET',
    path: '/ontology/schemas/:api/export',
    service: 'ONTOLOGY',
    minRole: 'Modeler',
    summary: 'Exports a schema as a pack',
    handler: (env, {ctx, params}) => env.ONTOLOGY.exportPack(ctx, params.api),
  }),
  route({
    method: 'GET',
    path: '/ontology/packs',
    service: 'ONTOLOGY',
    minRole: 'Viewer',
    summary: 'Lists scenario packs',
    handler: (env, {ctx}) => env.ONTOLOGY.listPacks(ctx),
  }),
  route({
    method: 'POST',
    path: '/ontology/packs:import',
    service: 'ONTOLOGY',
    minRole: 'Modeler',
    body: importPackInputSchema,
    idempotent: true,
    summary: 'BFF: imports a pack and installs its automations and KPIs',
    handler: (env, {ctx, body}) => importPackBff(env, ctx, body),
  }),

  // -- Integration ----------------------------------------------------------
  route({
    method: 'GET',
    path: '/sources',
    service: 'INTEGRATION',
    minRole: 'Viewer',
    summary: 'Lists data sources',
    handler: (env, {ctx}) => env.INTEGRATION.listSources(ctx),
  }),
  route({
    method: 'GET',
    path: '/sources/:id',
    service: 'INTEGRATION',
    minRole: 'Viewer',
    summary: 'Gets a data source',
    handler: (env, {ctx, params}) => env.INTEGRATION.getSource(ctx, params.id),
  }),
  route({
    method: 'POST',
    path: '/sources',
    service: 'INTEGRATION',
    minRole: 'Modeler',
    body: sourceDefSchema,
    idempotent: true,
    summary: 'Creates a data source',
    handler: (env, {ctx, body}) =>
      env.INTEGRATION.createSource(ctx, body as SourceDef),
  }),
  route({
    method: 'PATCH',
    path: '/sources/:id',
    service: 'INTEGRATION',
    minRole: 'Modeler',
    body: updateSourceBody,
    summary: 'Updates a data source',
    handler: (env, {ctx, params, body}) =>
      env.INTEGRATION.updateSource(ctx, params.id, body as Partial<SourceDef>),
  }),
  route({
    method: 'DELETE',
    path: '/sources/:id',
    service: 'INTEGRATION',
    minRole: 'Modeler',
    summary: 'Deletes a data source',
    handler: (env, {ctx, params}) =>
      env.INTEGRATION.deleteSource(ctx, params.id),
  }),
  route({
    method: 'POST',
    path: '/sources/:id/uploads:presign',
    service: 'INTEGRATION',
    minRole: 'Operator',
    body: presignInputSchema,
    summary: 'Presigned B2 PUT for archiving the raw file',
    handler: (env, {ctx, params, body}) =>
      env.INTEGRATION.presignUpload(ctx, params.id, body.fileName, body.bytes),
  }),
  route({
    method: 'POST',
    path: '/sources/:id/batches',
    service: 'INTEGRATION',
    minRole: 'Operator',
    body: batchInputSchema,
    idempotent: true,
    rateGroup: 'ingest',
    status: 202,
    maxBytes: 4 * 1024 * 1024,
    summary: 'Submits a batch of ≤ 500 records',
    handler: (env, {ctx, params, body}) =>
      env.INTEGRATION.submitBatch(ctx, params.id, body),
  }),
  route({
    method: 'POST',
    path: '/sources/:id/mapping:suggest',
    service: 'INTEGRATION',
    minRole: 'Modeler',
    body: suggestMappingInputSchema,
    rateGroup: 'ai',
    summary: 'BFF: AI mapping draft for the target type of the active model',
    handler: (env, {ctx, body}) => suggestMappingBff(env, ctx, body),
  }),
  route({
    method: 'GET',
    path: '/jobs',
    service: 'INTEGRATION',
    minRole: 'Viewer',
    query: jobsQuery,
    summary: 'Lists ingestion jobs',
    handler: (env, {ctx, query}) => env.INTEGRATION.listJobs(ctx, query),
  }),
  route({
    method: 'GET',
    path: '/jobs/:id',
    service: 'INTEGRATION',
    minRole: 'Viewer',
    summary: 'Gets an ingestion job',
    handler: (env, {ctx, params}) => env.INTEGRATION.getJob(ctx, params.id),
  }),
  route({
    method: 'GET',
    path: '/jobs/:id/rejected',
    service: 'INTEGRATION',
    minRole: 'Operator',
    summary: 'Lists rejected records of a job',
    handler: (env, {ctx, params}) =>
      env.INTEGRATION.listRejected(ctx, params.id),
  }),
  route({
    method: 'POST',
    path: '/jobs/:id/replay',
    service: 'INTEGRATION',
    minRole: 'Operator',
    body: replayInputSchema,
    idempotent: true,
    summary: 'Re-enqueues rejected records, optionally corrected',
    handler: (env, {ctx, params, body}) =>
      env.INTEGRATION.replayRejected(ctx, params.id, body.fixes),
  }),
  route({
    method: 'GET',
    path: '/data-health',
    service: 'INTEGRATION',
    minRole: 'Viewer',
    summary: 'Per-source freshness and quality',
    handler: (env, {ctx}) => env.INTEGRATION.dataHealth(ctx),
  }),
  route({
    method: 'POST',
    path: '/ingest/webhook/:sourceId',
    service: 'INTEGRATION',
    minRole: 'hmac',
    rateGroup: 'webhook',
    status: 202,
    maxBytes: 1024 * 1024,
    summary:
      'External webhook; X-OD-Signature = hex(HMAC-SHA256(secret, `${X-OD-Timestamp}.${body}`))',
    handler: webhook,
  }),

  // -- Object graph ---------------------------------------------------------
  route({
    method: 'GET',
    path: '/objects/:type',
    service: 'OBJECTS',
    minRole: 'Viewer',
    query: listObjectsQuery,
    summary: 'Lists objects of a type (filter is a JSON FilterExpr)',
    handler: (env, {ctx, params, query}) =>
      env.OBJECTS.listObjects(ctx, params.type, {
        filter: query.filter as FilterExpr | undefined,
        orderBy: query.orderBy,
        cursor: query.cursor,
        limit: query.limit,
      }),
  }),
  route({
    method: 'GET',
    path: '/objects/rid/:rid',
    service: 'OBJECTS',
    minRole: 'Viewer',
    query: getObjectQuery,
    summary: 'Gets an object, optionally with links',
    handler: async (env, {ctx, params, query}) => {
      const obj = await env.OBJECTS.getObject(ctx, params.rid as Rid, {
        expand: query.expand,
        depth: query.depth as 1 | 2 | undefined,
      });
      if (!obj) throw new AppError('OBJECT_NOT_FOUND');
      return obj;
    },
  }),
  route({
    method: 'GET',
    path: '/objects/rid/:rid/lineage',
    service: 'OBJECTS',
    minRole: 'Viewer',
    summary: 'Lineage of an object',
    handler: (env, {ctx, params}) =>
      env.OBJECTS.lineage(ctx, params.rid as Rid),
  }),
  route({
    method: 'GET',
    path: '/objects/rid/:rid/actions',
    service: 'OBJECTS',
    minRole: 'Viewer',
    query: limitQuery,
    summary: 'Action log of an object',
    handler: (env, {ctx, params, query}) =>
      env.OBJECTS.listActionLog(ctx, {
        rid: params.rid as Rid,
        limit: query.limit,
      }),
  }),
  route({
    method: 'GET',
    path: '/object-sets',
    service: 'OBJECTS',
    minRole: 'Viewer',
    summary: 'Lists saved object sets',
    handler: (env, {ctx}) => env.OBJECTS.listObjectSets(ctx),
  }),
  route({
    method: 'POST',
    path: '/object-sets',
    service: 'OBJECTS',
    minRole: 'Operator',
    body: saveObjectSetBody,
    idempotent: true,
    summary: 'Saves an object set',
    handler: (env, {ctx, body}) =>
      env.OBJECTS.saveObjectSet(ctx, {
        id: body.id,
        name: body.name,
        definition: body.definition as ObjectSetDef,
      }),
  }),
  route({
    method: 'POST',
    path: '/object-sets/:id/evaluate',
    service: 'OBJECTS',
    minRole: 'Viewer',
    body: pageInputSchema,
    rateGroup: 'read',
    summary: 'Evaluates a saved object set',
    handler: (env, {ctx, params, body}) =>
      env.OBJECTS.evaluateSavedObjectSet(ctx, params.id, body),
  }),
  route({
    method: 'POST',
    path: '/object-sets:evaluate',
    service: 'OBJECTS',
    minRole: 'Viewer',
    body: evaluateObjectSetBody,
    rateGroup: 'read',
    summary:
      'Evaluates an ad-hoc object set (`{definition, cursor?, limit?}` or the definition itself)',
    handler: (env, {ctx, body}) => {
      const {cursor, limit, ...rest} = body;
      const def = 'definition' in rest ? rest.definition : rest;
      return env.OBJECTS.evaluateObjectSet(ctx, def as ObjectSetDef, {
        cursor,
        limit,
      });
    },
  }),
  route({
    method: 'GET',
    path: '/search',
    service: 'OBJECTS',
    minRole: 'Viewer',
    query: searchQuery,
    summary: 'Full-text object search',
    handler: (env, {ctx, query}) =>
      env.OBJECTS.search(ctx, query.q, {type: query.type, limit: query.limit}),
  }),
  route({
    method: 'GET',
    path: '/graph/impact',
    service: 'OBJECTS',
    minRole: 'Viewer',
    query: impactQuery,
    summary: 'Impact subgraph around one or more rids (comma separated)',
    handler: (env, {ctx, query}) =>
      env.OBJECTS.impactSubgraph(ctx, {
        rids: query.rid as Rid[],
        maxHops: query.maxHops as 1 | 2 | 3,
        limit: query.limit,
        linkTypes: query.linkTypes,
      }),
  }),
  route({
    method: 'GET',
    path: '/graph/paths',
    service: 'OBJECTS',
    minRole: 'Viewer',
    query: pathsQuery,
    summary: 'Paths between two objects',
    handler: (env, {ctx, query}) =>
      env.OBJECTS.paths(ctx, {
        from: query.from as Rid,
        to: query.to as Rid,
        maxHops: query.maxHops,
      }),
  }),
  route({
    method: 'GET',
    path: '/merge-suggestions',
    service: 'OBJECTS',
    minRole: 'Modeler',
    summary: 'Entity-resolution merge suggestions',
    handler: (env, {ctx}) => env.OBJECTS.listMergeSuggestions(ctx),
  }),
  route({
    method: 'POST',
    path: '/merge-suggestions/:id/resolve',
    service: 'OBJECTS',
    minRole: 'Modeler',
    body: resolveMergeInputSchema,
    summary: 'Accepts or rejects a merge suggestion',
    handler: (env, {ctx, params, body}) =>
      env.OBJECTS.resolveMergeSuggestion(ctx, params.id, body.accept),
  }),
  route({
    method: 'POST',
    path: '/actions/:actionType/apply',
    service: 'OBJECTS',
    minRole: 'Operator',
    body: applyActionInputSchema,
    idempotent: true,
    summary: 'Applies an action (If-Match: expected object version)',
    handler: (env, {ctx, params, body, headers}) => {
      const cmd: ApplyActionCmd = {
        actionType: params.actionType,
        target: body.target as Rid,
        params: body.params,
        recommendationId: body.recommendationId,
        ifMatch: parseIfMatch(headers.get('if-match')),
      };
      return env.OBJECTS.applyAction(ctx, cmd);
    },
  }),

  // -- Situation ------------------------------------------------------------
  route({
    method: 'GET',
    path: '/situation/overview',
    service: 'SITUATION',
    minRole: 'Viewer',
    summary: 'BFF: situation overview merged with data health',
    handler: (env, {ctx}) => overviewBff(env, ctx),
  }),
  route({
    method: 'GET',
    path: '/situation/stream',
    service: 'SITUATION',
    minRole: 'Viewer',
    query: streamQuery,
    websocket: true,
    summary: 'WebSocket stream (?access_token=&lastSeq=)',
    handler: forwardStream,
  }),
  route({
    method: 'GET',
    path: '/kpis',
    service: 'SITUATION',
    minRole: 'Viewer',
    summary: 'Lists KPIs with current values',
    handler: (env, {ctx}) => env.SITUATION.listKpis(ctx),
  }),
  route({
    method: 'POST',
    path: '/kpis',
    service: 'SITUATION',
    minRole: 'Modeler',
    body: kpiDefSchema,
    idempotent: true,
    summary: 'Creates or updates a KPI',
    handler: (env, {ctx, body}) => env.SITUATION.saveKpi(ctx, body as KpiDef),
  }),
  route({
    method: 'DELETE',
    path: '/kpis/:id',
    service: 'SITUATION',
    minRole: 'Modeler',
    summary: 'Deletes a KPI',
    handler: (env, {ctx, params}) => env.SITUATION.deleteKpi(ctx, params.id),
  }),
  route({
    method: 'GET',
    path: '/kpis/:id/trend',
    service: 'SITUATION',
    minRole: 'Viewer',
    query: trendQuery,
    summary: 'KPI trend (24h or 7d)',
    handler: (env, {ctx, params, query}) =>
      env.SITUATION.kpiTrend(ctx, params.id, query.range),
  }),
  route({
    method: 'GET',
    path: '/automations',
    service: 'SITUATION',
    minRole: 'Viewer',
    summary: 'Lists automations',
    handler: (env, {ctx}) => env.SITUATION.listAutomations(ctx),
  }),
  route({
    method: 'POST',
    path: '/automations',
    service: 'SITUATION',
    minRole: 'Operator',
    body: automationDefSchema,
    idempotent: true,
    summary: 'Creates an automation',
    handler: (env, {ctx, body}) =>
      env.SITUATION.saveAutomation(ctx, body as AutomationDef),
  }),
  route({
    method: 'PUT',
    path: '/automations/:id',
    service: 'SITUATION',
    minRole: 'Operator',
    body: automationDefSchema,
    summary: 'Replaces an automation',
    handler: (env, {ctx, params, body}) =>
      env.SITUATION.saveAutomation(ctx, {
        ...(body as AutomationDef),
        id: params.id,
      }),
  }),
  route({
    method: 'DELETE',
    path: '/automations/:id',
    service: 'SITUATION',
    minRole: 'Operator',
    summary: 'Deletes an automation',
    handler: (env, {ctx, params}) =>
      env.SITUATION.deleteAutomation(ctx, params.id),
  }),
  route({
    method: 'POST',
    path: '/automations:dry-run',
    service: 'SITUATION',
    minRole: 'Operator',
    body: automationDefSchema,
    rateGroup: 'read',
    summary: 'Evaluates a draft automation without persisting',
    handler: (env, {ctx, body}) =>
      env.SITUATION.dryRunAutomation(ctx, body as AutomationDef),
  }),
  route({
    method: 'GET',
    path: '/alerts',
    service: 'SITUATION',
    minRole: 'Viewer',
    query: alertsQuery,
    summary: 'Lists alerts',
    handler: (env, {ctx, query}) =>
      env.SITUATION.listAlerts(ctx, {...query, rid: query.rid as Rid}),
  }),
  route({
    method: 'PATCH',
    path: '/alerts/:id',
    service: 'SITUATION',
    minRole: 'Operator',
    body: updateAlertInputSchema,
    critical: true,
    summary: 'Acknowledges or closes an alert',
    handler: (env, {ctx, params, body}) =>
      env.SITUATION.updateAlert(ctx, params.id, body),
  }),
  route({
    method: 'GET',
    path: '/cockpit/layout',
    service: 'SITUATION',
    minRole: 'Viewer',
    summary: 'Cockpit layout',
    handler: (env, {ctx}) => env.SITUATION.getLayout(ctx),
  }),
  route({
    method: 'PUT',
    path: '/cockpit/layout',
    service: 'SITUATION',
    minRole: 'Modeler',
    body: cockpitLayoutSchema,
    summary: 'Saves the cockpit layout',
    handler: (env, {ctx, body}) =>
      env.SITUATION.saveLayout(ctx, body as CockpitLayout),
  }),
  route({
    method: 'GET',
    path: '/usage',
    service: 'SITUATION',
    minRole: 'Viewer',
    summary: 'Free-tier usage status (quota bar)',
    handler: (env, {ctx}) => env.SITUATION.getUsage(ctx),
  }),
  route({
    method: 'GET',
    path: '/admin/usage',
    service: 'SITUATION',
    minRole: 'Admin',
    summary: 'UsageGuard status',
    handler: (env, {ctx}) => env.SITUATION.getUsage(ctx),
  }),
  route({
    method: 'GET',
    path: '/admin/dlq',
    service: 'SITUATION',
    minRole: 'Admin',
    query: dlqQuery,
    summary: 'Lists dead letters',
    handler: (env, {ctx, query}) =>
      env.SITUATION.listDeadLetters(ctx, query.queue),
  }),
  route({
    method: 'POST',
    path: '/admin/dlq/:queue/replay',
    service: 'SITUATION',
    minRole: 'Admin',
    body: replayDlqInputSchema,
    critical: true,
    summary: 'Replays dead letters of a queue',
    handler: (env, {ctx, params, body}) =>
      env.SITUATION.replayDeadLetters(ctx, params.queue, body.ids),
  }),
  route({
    method: 'POST',
    path: '/admin/graph:rebuild',
    service: 'OBJECTS',
    minRole: 'Admin',
    summary: 'Rebuilds the Neo4j projection from D1',
    handler: (env, {ctx}) => env.OBJECTS.rebuildProjection(ctx),
  }),

  // -- Decision -------------------------------------------------------------
  route({
    method: 'GET',
    path: '/scenarios',
    service: 'DECISION',
    minRole: 'Operator',
    summary: 'Lists scenarios',
    handler: (env, {ctx}) => env.DECISION.listScenarios(ctx),
  }),
  route({
    method: 'POST',
    path: '/scenarios',
    service: 'DECISION',
    minRole: 'Operator',
    body: scenarioInputSchema,
    idempotent: true,
    summary: 'Creates a scenario',
    handler: (env, {ctx, body}) =>
      env.DECISION.createScenario(ctx, body as ScenarioInput),
  }),
  route({
    method: 'GET',
    path: '/scenarios/:id',
    service: 'DECISION',
    minRole: 'Operator',
    summary: 'Gets a scenario',
    handler: (env, {ctx, params}) => env.DECISION.getScenario(ctx, params.id),
  }),
  route({
    method: 'POST',
    path: '/scenarios/:id/run',
    service: 'DECISION',
    minRole: 'Operator',
    body: runScenarioInputSchema,
    summary: 'Runs a saved scenario (optionally overriding its inputs)',
    handler: (env, {ctx, params, body}) =>
      env.DECISION.runScenario(ctx, {
        ...(body as ScenarioInput),
        scenarioId: params.id,
      }),
  }),
  route({
    method: 'POST',
    path: '/scenarios:run',
    service: 'DECISION',
    minRole: 'Operator',
    body: scenarioInputSchema,
    summary: 'Runs an ad-hoc scenario',
    handler: (env, {ctx, body}) =>
      env.DECISION.runScenario(ctx, body as ScenarioInput),
  }),
  route({
    method: 'POST',
    path: '/scenarios:candidates',
    service: 'DECISION',
    minRole: 'Operator',
    body: candidateActionsInputSchema,
    rateGroup: 'read',
    summary: 'Candidate actions for perturbed objects',
    handler: (env, {ctx, body}) =>
      env.DECISION.listCandidateActions(
        ctx,
        body.perturbations as Perturbation[],
      ),
  }),
  route({
    method: 'POST',
    path: '/recommendations:generate',
    service: 'DECISION',
    minRole: 'Operator',
    body: generateRecommendationInputSchema,
    rateGroup: 'ai',
    status: 202,
    summary: 'Queues recommendation generation; returns {jobId}',
    handler: (env, {ctx, body}) =>
      env.DECISION.generateRecommendation(ctx, {
        ...body,
        focus: body.focus as Rid,
        locale: body.locale ?? ctx.locale,
      }),
  }),
  route({
    method: 'GET',
    path: '/recommendations',
    service: 'DECISION',
    minRole: 'Viewer',
    query: recommendationsQuery,
    summary: 'Lists recommendations',
    handler: (env, {ctx, query}) =>
      env.DECISION.listRecommendations(ctx, {
        ...query,
        focus: query.focus as Rid | undefined,
      }),
  }),
  route({
    method: 'GET',
    path: '/recommendations/:id',
    service: 'DECISION',
    minRole: 'Viewer',
    summary: 'Gets a recommendation',
    handler: (env, {ctx, params}) =>
      env.DECISION.getRecommendation(ctx, params.id),
  }),
  route({
    method: 'POST',
    path: '/recommendations/:id/approve',
    service: 'DECISION',
    minRole: 'Operator',
    idempotent: true,
    critical: true,
    summary: 'Approves and executes a recommendation',
    handler: (env, {ctx, params}) => env.DECISION.approve(ctx, params.id),
  }),
  route({
    method: 'POST',
    path: '/recommendations/:id/reject',
    service: 'DECISION',
    minRole: 'Operator',
    body: rejectInputSchema,
    critical: true,
    summary: 'Rejects a recommendation',
    handler: (env, {ctx, params, body}) =>
      env.DECISION.reject(ctx, params.id, body.reason),
  }),
  route({
    method: 'POST',
    path: '/recommendations/:id/feedback',
    service: 'DECISION',
    minRole: 'Operator',
    body: feedbackInputSchema,
    summary: 'Rates an executed recommendation',
    handler: (env, {ctx, params, body}) =>
      env.DECISION.feedback(ctx, params.id, body),
  }),
  route({
    method: 'GET',
    path: '/llm/quota',
    service: 'DECISION',
    minRole: 'Viewer',
    summary: 'Remaining LLM calls today',
    handler: (env, {ctx}) => env.DECISION.llmQuota(ctx),
  }),

  // -- Gateway --------------------------------------------------------------
  route({
    method: 'GET',
    path: '/config',
    service: 'GATEWAY',
    minRole: 'public',
    summary: 'Runtime feature flags and version',
    handler: env => getConfig(env),
  }),
  route({
    method: 'POST',
    path: '/telemetry',
    service: 'GATEWAY',
    minRole: 'public',
    body: telemetryBody,
    status: 204,
    maxBytes: 16 * 1024,
    summary: 'Frontend errors and web-vitals (≤ 16 KB)',
    handler: telemetry,
  }),
  route({
    method: 'GET',
    path: '/openapi.json',
    service: 'GATEWAY',
    minRole: 'public',
    summary: 'OpenAPI 3.1 document generated from the route table',
    handler: async env => {
      const version = env.APP_VERSION ?? 'dev';
      if (openApiCache?.version !== version) {
        openApiCache = {version, doc: buildOpenApi(ROUTES, version)};
      }
      return openApiCache.doc;
    },
  }),
  route({
    method: 'GET',
    path: '/health',
    service: 'GATEWAY',
    minRole: 'public',
    summary: 'Liveness',
    handler: env => health(env),
  }),
];
