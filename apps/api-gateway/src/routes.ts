/**
 * @fileoverview The declarative public route table (ARCHITECTURE.md 5,
 * 修订说明书 10.2). One entry per operation; `op` is the operationId in
 * `openapi.yaml`. Handlers only map HTTP ↔ RPC: no business rules live in
 * the gateway.
 */

import type {RecStatus} from '@ontodecide/decision/contract';
import {
  decisionInputSchema,
  generateInputSchema,
  scenarioInputSchema,
} from '@ontodecide/decision/contract';
import {
  addPasskeySchema,
  adminDeleteUserSchema,
  adminSettingsPatchSchema,
  adminUserPatchSchema,
  blockedDomainsSchema,
  createSessionSchema,
  meCodeSchema,
  passkeyAssertionSchema,
  passkeyOptionsSchema,
  passkeySetupOptionsSchema,
  passkeySetupSchema,
  patchMeSchema,
  recoverySchema,
  sendCodeSchema,
  terminationSchema,
} from '@ontodecide/identity/contract';
import {
  batchSchema,
  createImportSchema,
  mappingDraftSchema,
  putMappingSchema,
} from '@ontodecide/integration/contract';
import {
  executeActionSchema,
  linksQuerySchema,
  mergePatchSchema,
  ridSchema,
} from '@ontodecide/object-graph/contract';
import {defSchemas, type DefKind} from '@ontodecide/ontology/contract';
import {
  alertQuerySchema,
  automationDefSchema,
} from '@ontodecide/situation/contract';
import {
  AppError,
  filterExprSchema,
  toEtag,
  type PageRequest,
  type Rid,
} from '@ontodecide/shared-kernel';
import {z} from 'zod';
import {
  assertionResponse,
  logoutHandler,
  refreshHandler,
  sessionResponse,
  sessionResultResponse,
  setupResponse,
} from './auth_handlers';
import {exportBff, getMeBff, getObjectWithLinksBff, overviewBff} from './bff';
import {empty, json, jsonWithEtag} from './http';
import {OPENAPI_YAML} from './openapi_spec';
import {route, type AnyRoute, type RouteHandler} from './route_types';
import {streamHandler} from './stream';

// —— Shared parameter and query schemas ——

/** Tenant / user id (26 upper-case alphanumerics, ULID-shaped). */
const ulidParam = z.string().regex(/^[0-9A-Z]{26}$/);
const idParam = z.string().min(1).max(128);
const apiNameParam = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/);
const tokenParam = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);

/** `?cursor=&limit=` (limit ≤ 100). */
export const pageQuerySchema = z.object({
  cursor: z.string().max(1024).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

function pageOf(q: {cursor?: string; limit?: number}): PageRequest {
  return {
    ...(q.cursor ? {cursor: q.cursor} : {}),
    ...(q.limit ? {limit: q.limit} : {}),
  };
}

const jsonParam = z
  .string()
  .max(8192)
  .transform((v, c) => {
    try {
      return JSON.parse(v) as unknown;
    } catch {
      c.addIssue({code: 'custom', message: 'Invalid JSON'});
      return z.NEVER;
    }
  });

/** GET /objects query. */
export const objectsQuerySchema = pageQuerySchema.extend({
  type: apiNameParam.optional(),
  q: z.string().max(200).optional(),
  filter: jsonParam.pipe(filterExprSchema).optional(),
  orderBy: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_]*:(asc|desc)$/)
    .transform(v => {
      const [prop, dir] = v.split(':');
      return {prop, dir: dir as 'asc' | 'desc'};
    })
    .optional(),
});

/** GET /objects/{rid} query (详细设计 表 9: `expand=links&depth=1|2`). */
export const objectQuerySchema = z.object({
  expand: z.enum(['links']).optional(),
  depth: z.coerce
    .number()
    .int()
    .min(1)
    .max(2)
    .default(1)
    .transform(v => v as 1 | 2),
  linkTypes: z
    .string()
    .max(1024)
    .optional()
    .transform(v => (v ? v.split(',').filter(Boolean) : undefined)),
});

const REC_STATUSES = [
  'Proposed',
  'Confirmed',
  'Rejected',
  'Expired',
  'Executed',
  'ExecFailed',
] as const satisfies readonly RecStatus[];

const recsQuerySchema = pageQuerySchema.extend({
  status: z.enum(REC_STATUSES).optional(),
});

const adminUsersQuerySchema = pageQuerySchema.extend({
  status: z.enum(['ACTIVE', 'EXPIRED', 'ARCHIVING', 'ARCHIVE_ONLY']).optional(),
});

const overviewQuerySchema = z.object({
  range: z.enum(['24h', '7d']).default('24h'),
});

const deleteUserQuerySchema = z.object({
  archive: z
    .enum(['true', 'false'])
    .default('true')
    .transform(v => v === 'true'),
});

// —— Helpers ——

const accepted = (): Response => empty(202);

/** Passkey endpoints: `step_up` needs an admin token, `login` a preAuth. */
function passkeyScope(body: unknown): 'public' | 'admin' {
  return (body as {purpose?: unknown} | undefined)?.purpose === 'step_up'
    ? 'admin'
    : 'public';
}

function passkeyAuth(
  purpose: 'login' | 'step_up',
  preAuth: string | undefined,
  ctx: Parameters<RouteHandler>[1]['ctx'],
): {preAuth: string} | {ctx: NonNullable<typeof ctx>} {
  if (purpose === 'step_up') return {ctx: ctx!};
  if (!preAuth) {
    throw new AppError('VALIDATION_FAILED', 'preAuth is required', {
      extras: {errors: [{path: 'preAuth', message: 'Required'}]},
    });
  }
  return {preAuth};
}

// —— Ontology definitions (object-types, link-types, action-types) ——

const DEF_OPS: Record<DefKind, string> = {
  'object-types': 'ObjectType',
  'link-types': 'LinkType',
  'action-types': 'ActionType',
};

function definitionRoutes(kind: DefKind): AnyRoute[] {
  const name = DEF_OPS[kind];
  const base = `/${kind}`;
  const item = `${base}/{id}`;
  const schema = defSchemas[kind] as z.ZodType<{apiName: string}>;
  return [
    route({
      op: `list${name}s`,
      method: 'GET',
      path: base,
      service: 'ONTOLOGY',
      scope: 'workspace',
      rate: ['read'],
      handler: async (env, i) => {
        const r = await env.ONTOLOGY.listDefinitions(i.ctx!, kind);
        return jsonWithEtag(r, r.etag);
      },
    }),
    route({
      op: `create${name}`,
      method: 'POST',
      path: base,
      service: 'ONTOLOGY',
      scope: 'workspace',
      rate: ['write'],
      require: ['If-Match'],
      body: schema,
      handler: async (env, i) => {
        const def = i.body as never;
        const r = await env.ONTOLOGY.putDefinition(
          i.ctx!,
          kind,
          i.body.apiName,
          def,
          i.ifMatch!,
        );
        return jsonWithEtag({item: i.body, etag: r.etag}, r.etag, 201);
      },
    }),
    route({
      op: `get${name}`,
      method: 'GET',
      path: item,
      service: 'ONTOLOGY',
      scope: 'workspace',
      rate: ['read'],
      params: {id: apiNameParam},
      handler: async (env, i) => {
        const r = await env.ONTOLOGY.getDefinition(i.ctx!, kind, i.params.id);
        return jsonWithEtag(r, r.etag);
      },
    }),
    route({
      op: `put${name}`,
      method: 'PUT',
      path: item,
      service: 'ONTOLOGY',
      scope: 'workspace',
      rate: ['write'],
      require: ['If-Match'],
      params: {id: apiNameParam},
      body: schema,
      handler: async (env, i) => {
        if (i.body.apiName !== i.params.id) {
          throw new AppError('VALIDATION_FAILED', 'apiName must match {id}', {
            extras: {errors: [{path: 'apiName', message: 'Must match {id}'}]},
          });
        }
        const r = await env.ONTOLOGY.putDefinition(
          i.ctx!,
          kind,
          i.params.id,
          i.body as never,
          i.ifMatch!,
        );
        return jsonWithEtag({item: i.body, etag: r.etag}, r.etag);
      },
    }),
    route({
      op: `delete${name}`,
      method: 'DELETE',
      path: item,
      service: 'ONTOLOGY',
      scope: 'workspace',
      rate: ['write'],
      require: ['If-Match'],
      params: {id: apiNameParam},
      handler: async (env, i) => {
        const r = await env.ONTOLOGY.deleteDefinition(
          i.ctx!,
          kind,
          i.params.id,
          i.ifMatch!,
        );
        return empty(204, {etag: toEtag(r.etag)});
      },
    }),
  ];
}

// —— The table ——

/** Every public route below `/api/v1`. */
export const ROUTES: AnyRoute[] = [
  // —— auth ——
  route({
    op: 'sendCode',
    method: 'POST',
    path: '/auth/codes',
    service: 'IDENTITY',
    scope: 'public',
    rate: ['email', 'ip'],
    body: sendCodeSchema,
    handler: async (env, i) => {
      await env.IDENTITY.sendCode(i.body, i.meta);
      return accepted();
    },
  }),
  route({
    op: 'createSession',
    method: 'POST',
    path: '/auth/sessions',
    service: 'IDENTITY',
    scope: 'public',
    rate: ['ip'],
    body: createSessionSchema,
    handler: async (env, i) =>
      sessionResultResponse(
        await env.IDENTITY.createSession(i.body, i.meta),
        i.clock,
      ),
  }),
  route({
    op: 'refreshSession',
    method: 'POST',
    path: '/auth/sessions/refresh',
    service: 'IDENTITY',
    scope: 'refresh',
    rate: ['ip'],
    clearCookieOnError: true,
    handler: refreshHandler,
  }),
  route({
    op: 'logout',
    method: 'DELETE',
    path: '/auth/sessions/current',
    service: 'IDENTITY',
    scope: 'workspace',
    rate: ['write'],
    allowExpired: true,
    ownAccount: true,
    clearCookieOnError: true,
    handler: logoutHandler,
  }),
  route({
    op: 'passkeyOptions',
    method: 'POST',
    path: '/auth/passkeys/options',
    service: 'IDENTITY',
    scope: passkeyScope,
    rate: ['ip'],
    body: passkeyOptionsSchema,
    handler: async (env, i) =>
      json(
        await env.IDENTITY.passkeyOptions(
          passkeyAuth(i.body.purpose, i.body.preAuth, i.ctx),
          i.body.purpose,
        ),
      ),
  }),
  route({
    op: 'passkeyAssertion',
    method: 'POST',
    path: '/auth/passkeys/assertion',
    service: 'IDENTITY',
    scope: passkeyScope,
    rate: ['ip'],
    body: passkeyAssertionSchema,
    handler: async (env, i) =>
      assertionResponse(
        await env.IDENTITY.passkeyAssertion(
          passkeyAuth(i.body.purpose, i.body.preAuth, i.ctx),
          i.body.purpose,
          i.body.credential,
          i.meta,
        ),
        i.clock,
      ),
  }),
  route({
    op: 'passkeySetupOptions',
    method: 'POST',
    path: '/auth/passkeys/setup-options',
    service: 'IDENTITY',
    scope: 'public',
    rate: ['ip'],
    body: passkeySetupOptionsSchema,
    handler: async (env, i) =>
      json(
        await env.IDENTITY.passkeySetupOptions(
          i.body.preAuth,
          i.body.setupCode,
        ),
      ),
  }),
  route({
    op: 'passkeySetup',
    method: 'POST',
    path: '/auth/passkeys/setup',
    service: 'IDENTITY',
    scope: 'public',
    rate: ['ip'],
    body: passkeySetupSchema,
    handler: async (env, i) =>
      setupResponse(
        await env.IDENTITY.passkeySetup(
          i.body.preAuth,
          i.body.setupCode,
          i.body.credential,
          i.meta,
        ),
        i.clock,
      ),
  }),
  route({
    op: 'recoveryLogin',
    method: 'POST',
    path: '/auth/recovery',
    service: 'IDENTITY',
    scope: 'public',
    rate: ['ip'],
    body: recoverySchema,
    handler: async (env, i) =>
      sessionResponse(
        await env.IDENTITY.recoveryLogin(
          i.body.preAuth,
          i.body.recoveryCode,
          i.meta,
        ),
        i.clock,
      ),
  }),

  // —— me / workspace ——
  route({
    op: 'getMe',
    method: 'GET',
    path: '/me',
    service: 'IDENTITY',
    scope: 'workspace',
    rate: ['read'],
    handler: (env, i) => getMeBff(env, i.ctx!, i.clock, i.logger),
  }),
  route({
    op: 'patchMe',
    method: 'PATCH',
    path: '/me',
    service: 'IDENTITY',
    scope: 'workspace',
    rate: ['write'],
    ownAccount: true,
    body: patchMeSchema,
    handler: async (env, i) => json(await env.IDENTITY.patchMe(i.ctx!, i.body)),
  }),
  route({
    op: 'sendMeCode',
    method: 'POST',
    path: '/me/codes',
    service: 'IDENTITY',
    scope: 'workspace',
    rate: ['write'],
    ownAccount: true,
    body: meCodeSchema,
    handler: async (env, i) => {
      await env.IDENTITY.sendMeCode(i.ctx!, i.body.purpose);
      return accepted();
    },
  }),
  route({
    op: 'terminateTrial',
    method: 'POST',
    path: '/me/trial/termination',
    service: 'IDENTITY',
    scope: 'workspace',
    rate: ['write'],
    ownAccount: true,
    body: terminationSchema,
    handler: async (env, i) => {
      await env.IDENTITY.terminateTrial(i.ctx!, i.body.code);
      return accepted();
    },
  }),
  route({
    op: 'exportWorkspace',
    method: 'GET',
    path: '/me/export',
    service: 'IDENTITY',
    scope: 'workspace',
    rate: ['read'],
    handler: (env, i) => exportBff(env, i.ctx!, i.clock),
  }),
  route({
    op: 'loadSampleData',
    method: 'POST',
    path: '/workspace/sample-data',
    service: 'INTEGRATION',
    scope: 'workspace',
    rate: ['write'],
    handler: async (env, i) =>
      json(await env.INTEGRATION.loadSample(i.ctx!), 202),
  }),

  // —— archive deletion links (public, by IP) ——
  route({
    op: 'getArchiveDeletion',
    method: 'GET',
    path: '/archive-deletions/{token}',
    service: 'IDENTITY',
    scope: 'public',
    rate: ['ip'],
    params: {token: tokenParam},
    handler: async (env, i) =>
      json(await env.IDENTITY.getArchiveDeletion(i.params.token)),
  }),
  route({
    op: 'confirmArchiveDeletion',
    method: 'POST',
    path: '/archive-deletions/{token}',
    service: 'IDENTITY',
    scope: 'public',
    rate: ['ip'],
    params: {token: tokenParam},
    handler: async (env, i) => {
      await env.IDENTITY.deleteArchiveByToken(i.params.token);
      return empty();
    },
  }),

  // —— ontology ——
  route({
    op: 'getOntology',
    method: 'GET',
    path: '/ontology',
    service: 'ONTOLOGY',
    scope: 'workspace',
    rate: ['read'],
    handler: async (env, i) => {
      const o = await env.ONTOLOGY.getOntology(i.ctx!);
      return jsonWithEtag(o, o.etag);
    },
  }),
  ...definitionRoutes('object-types'),
  ...definitionRoutes('link-types'),
  ...definitionRoutes('action-types'),

  // —— imports ——
  route({
    op: 'listImports',
    method: 'GET',
    path: '/imports',
    service: 'INTEGRATION',
    scope: 'workspace',
    rate: ['read'],
    query: pageQuerySchema,
    handler: async (env, i) =>
      json(await env.INTEGRATION.listImports(i.ctx!, pageOf(i.query))),
  }),
  route({
    op: 'createImport',
    method: 'POST',
    path: '/imports',
    service: 'INTEGRATION',
    scope: 'workspace',
    rate: ['write'],
    body: createImportSchema,
    handler: async (env, i) =>
      json(await env.INTEGRATION.createImport(i.ctx!, i.body), 201),
  }),
  route({
    op: 'getImport',
    method: 'GET',
    path: '/imports/{id}',
    service: 'INTEGRATION',
    scope: 'workspace',
    rate: ['read'],
    params: {id: idParam},
    handler: async (env, i) =>
      json(await env.INTEGRATION.getImport(i.ctx!, i.params.id)),
  }),
  route({
    op: 'putImportMapping',
    method: 'PUT',
    path: '/imports/{id}/mapping',
    service: 'INTEGRATION',
    scope: 'workspace',
    rate: ['write'],
    params: {id: idParam},
    body: putMappingSchema,
    handler: async (env, i) =>
      json(
        await env.INTEGRATION.putMapping(i.ctx!, i.params.id, i.body.mapping),
      ),
  }),
  route({
    op: 'submitImportBatch',
    method: 'POST',
    path: '/imports/{id}/batches',
    service: 'INTEGRATION',
    scope: 'workspace',
    rate: ['write'],
    params: {id: idParam},
    body: batchSchema,
    handler: async (env, i) =>
      json(await env.INTEGRATION.submitBatch(i.ctx!, i.params.id, i.body)),
  }),
  route({
    op: 'draftImportMapping',
    method: 'POST',
    path: '/imports/{id}/mapping-draft',
    service: 'INTEGRATION',
    scope: 'workspace',
    rate: ['write'],
    params: {id: idParam},
    body: mappingDraftSchema,
    handler: async (env, i) =>
      json(await env.INTEGRATION.mappingDraft(i.ctx!, i.params.id, i.body)),
  }),

  // —— objects ——
  route({
    op: 'listObjects',
    method: 'GET',
    path: '/objects',
    service: 'OBJECTS',
    scope: 'workspace',
    rate: ['read'],
    query: objectsQuerySchema,
    handler: async (env, i) => {
      const {type, q, filter, orderBy} = i.query;
      const query = {
        ...(type ? {type} : {}),
        ...(q ? {q} : {}),
        ...(filter ? {filter} : {}),
        ...(orderBy ? {orderBy} : {}),
      };
      return json(
        await env.OBJECTS.listObjects(i.ctx!, query, pageOf(i.query)),
      );
    },
  }),
  route({
    op: 'getObjectStats',
    method: 'GET',
    path: '/objects/stats',
    service: 'OBJECTS',
    scope: 'workspace',
    rate: ['read'],
    handler: async (env, i) => json(await env.OBJECTS.stats(i.ctx!)),
  }),
  route({
    op: 'getObject',
    method: 'GET',
    path: '/objects/{rid}',
    service: 'OBJECTS',
    scope: 'workspace',
    rate: ['read'],
    params: {rid: ridSchema},
    query: objectQuerySchema,
    handler: async (env, i) => {
      const {expand, depth, linkTypes} = i.query;
      if (expand === 'links') {
        return getObjectWithLinksBff(env, i.ctx!, i.params.rid as Rid, {
          depth,
          ...(linkTypes ? {linkTypes} : {}),
        });
      }
      const o = await env.OBJECTS.getObject(i.ctx!, i.params.rid as Rid);
      if (!o) throw new AppError('NOT_FOUND');
      return jsonWithEtag(o, o.version);
    },
  }),
  route({
    op: 'patchObject',
    method: 'PATCH',
    path: '/objects/{rid}',
    service: 'OBJECTS',
    scope: 'workspace',
    rate: ['write'],
    require: ['If-Match'],
    params: {rid: ridSchema},
    body: mergePatchSchema,
    handler: async (env, i) => {
      const o = await env.OBJECTS.patchObject(
        i.ctx!,
        i.params.rid as Rid,
        i.body,
        i.ifMatch!,
      );
      return jsonWithEtag(o, o.version);
    },
  }),
  route({
    op: 'getObjectLinks',
    method: 'GET',
    path: '/objects/{rid}/links',
    service: 'OBJECTS',
    scope: 'workspace',
    rate: ['read'],
    params: {rid: ridSchema},
    query: linksQuerySchema,
    handler: async (env, i) => {
      const {depth, linkTypes, direction, limit} = i.query;
      return json(
        await env.OBJECTS.getLinks(i.ctx!, i.params.rid as Rid, {
          depth: depth as 1 | 2,
          direction,
          limit,
          ...(linkTypes ? {linkTypes} : {}),
        }),
      );
    },
  }),
  route({
    op: 'listObjectActions',
    method: 'GET',
    path: '/objects/{rid}/actions',
    service: 'OBJECTS',
    scope: 'workspace',
    rate: ['read'],
    params: {rid: ridSchema},
    query: pageQuerySchema,
    handler: async (env, i) =>
      json(
        await env.OBJECTS.listActionLog(
          i.ctx!,
          i.params.rid as Rid,
          pageOf(i.query),
        ),
      ),
  }),
  route({
    op: 'executeAction',
    method: 'POST',
    path: '/action-types/{id}/executions',
    service: 'OBJECTS',
    scope: 'workspace',
    rate: ['write'],
    require: ['Idempotency-Key', 'If-Match'],
    params: {id: apiNameParam},
    body: executeActionSchema,
    handler: async (env, i) => {
      const r = await env.OBJECTS.applyAction(i.ctx!, {
        actionType: i.params.id,
        target: i.body.target as Rid,
        params: i.body.params,
        ifMatch: i.ifMatch,
        idempotencyKey: i.idempotencyKey!,
        ...(i.body.recommendationId
          ? {recommendationId: i.body.recommendationId}
          : {}),
      });
      return jsonWithEtag(r, r.version);
    },
  }),

  // —— situation ——
  route({
    op: 'getSituationOverview',
    method: 'GET',
    path: '/situation/overview',
    service: 'SITUATION',
    scope: 'workspace',
    rate: ['read'],
    query: overviewQuerySchema,
    handler: (env, i) =>
      overviewBff(env, i.ctx!, i.query.range, i.clock, i.logger),
  }),
  route({
    op: 'listAlerts',
    method: 'GET',
    path: '/alerts',
    service: 'SITUATION',
    scope: 'workspace',
    rate: ['read'],
    query: alertQuerySchema,
    handler: async (env, i) => {
      const {status, severity, rid} = i.query;
      const filter = {
        ...(status ? {status} : {}),
        ...(severity ? {severity} : {}),
        ...(rid ? {rid: rid as Rid} : {}),
      };
      return json(
        await env.SITUATION.listAlerts(i.ctx!, filter, pageOf(i.query)),
      );
    },
  }),
  route({
    op: 'acknowledgeAlert',
    method: 'POST',
    path: '/alerts/{id}/acknowledgement',
    service: 'SITUATION',
    scope: 'workspace',
    rate: ['write'],
    params: {id: idParam},
    handler: async (env, i) =>
      json(await env.SITUATION.acknowledgeAlert(i.ctx!, i.params.id)),
  }),
  route({
    op: 'listAutomations',
    method: 'GET',
    path: '/automations',
    service: 'SITUATION',
    scope: 'workspace',
    rate: ['read'],
    handler: async (env, i) =>
      json(await env.SITUATION.listAutomations(i.ctx!)),
  }),
  route({
    op: 'createAutomation',
    method: 'POST',
    path: '/automations',
    service: 'SITUATION',
    scope: 'workspace',
    rate: ['write'],
    body: automationDefSchema,
    handler: async (env, i) => {
      const a = await env.SITUATION.createAutomation(i.ctx!, i.body);
      return jsonWithEtag(a, a.version, 201);
    },
  }),
  route({
    op: 'getAutomation',
    method: 'GET',
    path: '/automations/{id}',
    service: 'SITUATION',
    scope: 'workspace',
    rate: ['read'],
    params: {id: idParam},
    handler: async (env, i) => {
      const a = await env.SITUATION.getAutomation(i.ctx!, i.params.id);
      return jsonWithEtag(a, a.version);
    },
  }),
  route({
    op: 'putAutomation',
    method: 'PUT',
    path: '/automations/{id}',
    service: 'SITUATION',
    scope: 'workspace',
    rate: ['write'],
    require: ['If-Match'],
    params: {id: idParam},
    body: automationDefSchema,
    handler: async (env, i) => {
      const a = await env.SITUATION.putAutomation(
        i.ctx!,
        i.params.id,
        i.body,
        i.ifMatch!,
      );
      return jsonWithEtag(a, a.version);
    },
  }),
  route({
    op: 'deleteAutomation',
    method: 'DELETE',
    path: '/automations/{id}',
    service: 'SITUATION',
    scope: 'workspace',
    rate: ['write'],
    require: ['If-Match'],
    params: {id: idParam},
    handler: async (env, i) => {
      await env.SITUATION.deleteAutomation(i.ctx!, i.params.id, i.ifMatch!);
      return empty();
    },
  }),
  route({
    op: 'issueStreamTicket',
    method: 'POST',
    path: '/situation/stream-tickets',
    service: 'SITUATION',
    scope: 'workspace',
    rate: ['write'],
    handler: async (env, i) =>
      json(await env.SITUATION.issueStreamTicket(i.ctx!), 201),
  }),
  route({
    op: 'openSituationStream',
    method: 'GET',
    path: '/situation/stream',
    service: 'SITUATION',
    scope: 'stream',
    rate: [],
    handler: streamHandler,
  }),

  // —— decision ——
  route({
    op: 'runScenario',
    method: 'POST',
    path: '/scenarios',
    service: 'DECISION',
    scope: 'workspace',
    rate: ['write'],
    body: scenarioInputSchema,
    handler: async (env, i) =>
      json(await env.DECISION.runScenario(i.ctx!, i.body as never), 201),
  }),
  route({
    op: 'getScenario',
    method: 'GET',
    path: '/scenarios/{id}',
    service: 'DECISION',
    scope: 'workspace',
    rate: ['read'],
    params: {id: idParam},
    handler: async (env, i) =>
      json(await env.DECISION.getScenario(i.ctx!, i.params.id)),
  }),
  route({
    op: 'listRecommendations',
    method: 'GET',
    path: '/recommendations',
    service: 'DECISION',
    scope: 'workspace',
    rate: ['read'],
    query: recsQuerySchema,
    handler: async (env, i) =>
      json(
        await env.DECISION.listRecommendations(
          i.ctx!,
          i.query.status ? {status: i.query.status} : {},
          pageOf(i.query),
        ),
      ),
  }),
  route({
    op: 'getRecommendation',
    method: 'GET',
    path: '/recommendations/{id}',
    service: 'DECISION',
    scope: 'workspace',
    rate: ['read'],
    params: {id: idParam},
    handler: async (env, i) =>
      json(await env.DECISION.getRecommendation(i.ctx!, i.params.id)),
  }),
  route({
    op: 'generateRecommendation',
    method: 'POST',
    path: '/recommendations',
    service: 'DECISION',
    scope: 'workspace',
    rate: ['write'],
    body: generateInputSchema,
    handler: async (env, i) =>
      json(
        await env.DECISION.generateRecommendation(i.ctx!, i.body as never),
        201,
      ),
  }),
  route({
    op: 'decideRecommendation',
    method: 'POST',
    path: '/recommendations/{id}/decision',
    service: 'DECISION',
    scope: 'workspace',
    rate: ['write'],
    require: ['Idempotency-Key'],
    params: {id: idParam},
    body: decisionInputSchema,
    handler: async (env, i) =>
      json(
        await env.DECISION.decide(
          i.ctx!,
          i.params.id,
          i.body,
          i.idempotencyKey!,
        ),
      ),
  }),

  // —— admin ——
  route({
    op: 'adminOverview',
    method: 'GET',
    path: '/admin/overview',
    service: 'IDENTITY',
    scope: 'admin',
    rate: ['read'],
    handler: async (env, i) => json(await env.IDENTITY.adminOverview(i.ctx!)),
  }),
  route({
    op: 'adminListUsers',
    method: 'GET',
    path: '/admin/users',
    service: 'IDENTITY',
    scope: 'admin',
    rate: ['read'],
    query: adminUsersQuerySchema,
    handler: async (env, i) =>
      json(
        await env.IDENTITY.adminListUsers(
          i.ctx!,
          i.query.status ? {status: i.query.status} : {},
          pageOf(i.query),
        ),
      ),
  }),
  route({
    op: 'adminGetUser',
    method: 'GET',
    path: '/admin/users/{uid}',
    service: 'IDENTITY',
    scope: 'admin',
    rate: ['read'],
    params: {uid: ulidParam},
    handler: async (env, i) =>
      json(await env.IDENTITY.adminGetUser(i.ctx!, i.params.uid)),
  }),
  route({
    op: 'adminPatchUser',
    method: 'PATCH',
    path: '/admin/users/{uid}',
    service: 'IDENTITY',
    scope: 'admin',
    rate: ['write'],
    require: ['Idempotency-Key', 'X-Step-Up'],
    params: {uid: ulidParam},
    body: adminUserPatchSchema,
    handler: async (env, i) =>
      json(
        await env.IDENTITY.adminPatchUser(
          i.ctx!,
          i.params.uid,
          i.body,
          i.stepUp!,
          i.idempotencyKey!,
        ),
      ),
  }),
  route({
    op: 'adminRevokeSessions',
    method: 'DELETE',
    path: '/admin/users/{uid}/sessions',
    service: 'IDENTITY',
    scope: 'admin',
    rate: ['write'],
    require: ['Idempotency-Key'],
    params: {uid: ulidParam},
    handler: async (env, i) =>
      json(
        await env.IDENTITY.adminRevokeSessions(
          i.ctx!,
          i.params.uid,
          i.idempotencyKey!,
        ),
      ),
  }),
  route({
    op: 'adminDeleteUser',
    method: 'DELETE',
    path: '/admin/users/{uid}',
    service: 'IDENTITY',
    scope: 'admin',
    rate: ['write'],
    require: ['Idempotency-Key', 'X-Step-Up'],
    params: {uid: ulidParam},
    query: deleteUserQuerySchema,
    body: adminDeleteUserSchema,
    handler: async (env, i) => {
      await env.IDENTITY.adminDeleteUser(
        i.ctx!,
        i.params.uid,
        {archive: i.query.archive, reason: i.body.reason},
        i.stepUp!,
        i.idempotencyKey!,
      );
      return accepted();
    },
  }),
  route({
    op: 'adminListArchives',
    method: 'GET',
    path: '/admin/archives',
    service: 'IDENTITY',
    scope: 'admin',
    rate: ['read'],
    query: pageQuerySchema,
    handler: async (env, i) =>
      json(await env.IDENTITY.adminListArchives(i.ctx!, pageOf(i.query))),
  }),
  route({
    op: 'adminArchiveLink',
    method: 'POST',
    path: '/admin/archives/{tid}/download-link',
    service: 'IDENTITY',
    scope: 'admin',
    rate: ['write'],
    require: ['Idempotency-Key'],
    params: {tid: ulidParam},
    handler: async (env, i) =>
      json(
        await env.IDENTITY.adminArchiveLink(
          i.ctx!,
          i.params.tid,
          i.idempotencyKey!,
        ),
      ),
  }),
  route({
    op: 'adminDeleteArchive',
    method: 'DELETE',
    path: '/admin/archives/{tid}',
    service: 'IDENTITY',
    scope: 'admin',
    rate: ['write'],
    require: ['Idempotency-Key', 'X-Step-Up'],
    params: {tid: ulidParam},
    handler: async (env, i) => {
      await env.IDENTITY.adminDeleteArchive(
        i.ctx!,
        i.params.tid,
        i.stepUp!,
        i.idempotencyKey!,
      );
      return empty();
    },
  }),
  route({
    op: 'adminGetSettings',
    method: 'GET',
    path: '/admin/settings',
    service: 'IDENTITY',
    scope: 'admin',
    rate: ['read'],
    handler: async (env, i) => {
      const s = await env.IDENTITY.adminGetSettings(i.ctx!);
      return jsonWithEtag(s, s.version);
    },
  }),
  route({
    op: 'adminPatchSettings',
    method: 'PATCH',
    path: '/admin/settings',
    service: 'IDENTITY',
    scope: 'admin',
    rate: ['write'],
    require: ['If-Match', 'Idempotency-Key', 'X-Step-Up'],
    body: adminSettingsPatchSchema,
    handler: async (env, i) => {
      const s = await env.IDENTITY.adminPatchSettings(
        i.ctx!,
        i.body,
        i.ifMatch!,
        i.stepUp!,
        i.idempotencyKey!,
      );
      return jsonWithEtag(s, s.version);
    },
  }),
  route({
    op: 'adminGetBlockedDomains',
    method: 'GET',
    path: '/admin/blocked-domains',
    service: 'IDENTITY',
    scope: 'admin',
    rate: ['read'],
    handler: async (env, i) =>
      json({domains: await env.IDENTITY.adminGetBlockedDomains(i.ctx!)}),
  }),
  route({
    op: 'adminPutBlockedDomains',
    method: 'PUT',
    path: '/admin/blocked-domains',
    service: 'IDENTITY',
    scope: 'admin',
    rate: ['write'],
    require: ['Idempotency-Key'],
    body: blockedDomainsSchema,
    handler: async (env, i) =>
      json({
        domains: await env.IDENTITY.adminPutBlockedDomains(
          i.ctx!,
          i.body.domains,
          i.idempotencyKey!,
        ),
      }),
  }),
  route({
    op: 'adminAuditLog',
    method: 'GET',
    path: '/admin/audit-log',
    service: 'IDENTITY',
    scope: 'admin',
    rate: ['read'],
    query: pageQuerySchema,
    handler: async (env, i) =>
      json(await env.IDENTITY.adminAuditLog(i.ctx!, pageOf(i.query))),
  }),
  route({
    op: 'adminListPasskeys',
    method: 'GET',
    path: '/admin/passkeys',
    service: 'IDENTITY',
    scope: 'admin',
    rate: ['read'],
    recoveryOk: true,
    handler: async (env, i) =>
      json(await env.IDENTITY.adminListPasskeys(i.ctx!)),
  }),
  route({
    op: 'adminPasskeyOptions',
    method: 'POST',
    path: '/admin/passkeys/options',
    service: 'IDENTITY',
    scope: 'admin',
    rate: ['write'],
    recoveryOk: true,
    handler: async (env, i) =>
      json(await env.IDENTITY.adminPasskeyOptions(i.ctx!)),
  }),
  route({
    op: 'adminAddPasskey',
    method: 'POST',
    path: '/admin/passkeys',
    service: 'IDENTITY',
    scope: 'admin',
    rate: ['write'],
    require: ['X-Step-Up'],
    recoveryOk: true,
    body: addPasskeySchema,
    handler: async (env, i) =>
      json(
        await env.IDENTITY.adminAddPasskey(
          i.ctx!,
          i.body.credential,
          i.body.label,
          i.stepUp ?? '',
        ),
        201,
      ),
  }),
  route({
    op: 'adminDeletePasskey',
    method: 'DELETE',
    path: '/admin/passkeys/{id}',
    service: 'IDENTITY',
    scope: 'admin',
    rate: ['write'],
    require: ['X-Step-Up'],
    params: {id: idParam},
    handler: async (env, i) => {
      await env.IDENTITY.adminDeletePasskey(i.ctx!, i.params.id, i.stepUp!);
      return empty();
    },
  }),

  // —— ops ——
  route({
    op: 'getHealth',
    method: 'GET',
    path: '/health',
    service: 'GATEWAY',
    scope: 'public',
    rate: [],
    handler: async env =>
      json({
        status: 'ok',
        version: env.APP_VERSION ?? 'dev',
        environment: env.ENVIRONMENT ?? 'local',
      }),
  }),
  route({
    op: 'getOpenApi',
    method: 'GET',
    path: '/openapi.yaml',
    service: 'GATEWAY',
    scope: 'public',
    rate: [],
    handler: async () =>
      new Response(OPENAPI_YAML, {
        headers: {'content-type': 'application/yaml; charset=utf-8'},
      }),
  }),
];
