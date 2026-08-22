/**
 * Graph HTTP handlers (Hono + @hono/zod-openapi).
 *
 * All routes are mounted at the root inside this Worker; the Gateway strips
 * the `/api` prefix before forwarding, so `GET /ontology` here corresponds to
 * `GET /api/ontology` externally.
 *
 *   GET    /ontology               — list tenant ontology
 *   POST   /ontology               — upsert ontology type
 *   POST   /entities               — batch upsert entities + relations
 *   GET    /entities                — find entities by type/attributes
 *   GET    /entities/:id            — single entity
 *   DELETE /entities/:id            — delete entity + relations
 *   GET    /situation/:id           — situation view
 *   POST   /graph/explore           — multi-hop exploration
 *   POST   /graph/query             — custom Cypher (admin only)
 *
 * Request bodies are validated by the Zod schemas declared on each route in
 * `index.ts`; handlers consume the already-validated body via `c.req.json()`.
 * Business errors are thrown as {@link throwError} so the global
 * `honoErrorHandler` can translate them into the standard envelope.
 */
import type { Context } from 'hono';
import type { z } from 'zod';
import { getAuthContext } from '@ontodecide/shared/hono';
import {
  ERROR_CODES,
  HEADERS,
  ok,
  throwError,
  type CypherQueryRequest,
  type ExploreRequest,
  type IngestPayload,
  type OntologyType,
} from '@ontodecide/shared';
import type { ontologyTypeSchema } from '@ontodecide/shared';
import type { GraphEnv } from '../types/env.js';
import type { OntologyService } from '../service/ontology.service.js';
import type { SituationService } from '../service/situation.service.js';
import type { EntityService } from '../service/entity.service.js';
import type { Neo4jRepository } from '../repository/neo4j.repository.js';

/** Per-request service bindings injected by the entry-point middleware. */
export interface GraphVars {
  repo: Neo4jRepository;
  ontology: OntologyService;
  situation: SituationService;
  entities: EntityService;
}

/** Hono context typed with the Graph Worker's Bindings and Variables. */
export type GraphContext = Context<{ Bindings: GraphEnv; Variables: GraphVars }>;

/**
 * Mutable DTO shape of {@link OntologyType} (Zod-inferred). Used for response
 * payloads because `OntologyType` declares `readonly` arrays that do not
 * structurally match the `string[]` inferred from {@link ontologyTypeSchema}.
 */
type OntologyTypeDto = z.infer<typeof ontologyTypeSchema>;

/** Build a tenant id from the Gateway header, rejecting missing values. */
function tenant(c: GraphContext): string {
  const tid = c.req.header(HEADERS.TENANT_ID);
  if (!tid) {
    throwError(ERROR_CODES.AUTH_FORBIDDEN, 'Missing tenant id.');
  }
  // `throwError` returns `never`, but when imported across modules TypeScript
  // does not always narrow `tid` inside this branch. Use a non-null assertion
  // (semantically safe: we would have thrown above for the undefined case).
  return tid!;
}

/** GET /ontology */
export async function listOntologyHandler(c: GraphContext) {
  const items = await c.var.ontology.list(tenant(c));
  return c.json(ok(items as OntologyTypeDto[]), 200);
}

/** POST /ontology  body: OntologyType */
export async function upsertOntologyHandler(c: GraphContext) {
  const body = (await c.req.json()) as OntologyType;
  await c.var.ontology.upsert(tenant(c), body);
  return c.json(ok({ success: true }), 200);
}

/** POST /entities  body: IngestPayload */
export async function upsertEntitiesHandler(c: GraphContext) {
  const body = (await c.req.json()) as IngestPayload;
  // Enforce tenant isolation: the body's tenant_id must match the header
  // injected by the Gateway.
  const tid = tenant(c);
  if (body.tenant_id !== tid) {
    throwError(ERROR_CODES.AUTH_FORBIDDEN, 'tenant_id mismatch.');
  }
  const result = await c.var.entities.upsert(body);
  return c.json(ok(result), 200);
}

/** GET /entities?type=asset&attr.key=value */
export async function findEntitiesHandler(c: GraphContext) {
  const params = new URL(c.req.url).searchParams;
  const type = params.get('type') ?? undefined;
  const attributes: Record<string, unknown> = {};
  for (const [key, value] of params.entries()) {
    if (key.startsWith('attr.')) {
      attributes[key.slice('attr.'.length)] = value;
    }
  }
  const items = await c.var.situation.findEntities(tenant(c), {
    type,
    attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
  });
  return c.json(ok(items), 200);
}

/** GET /entities/:id */
export async function findEntityHandler(c: GraphContext) {
  const id = c.req.param('id')!;
  const entity = await c.var.situation.findEntity(tenant(c), id);
  if (!entity) {
    throwError(ERROR_CODES.GRAPH_ENTITY_NOT_FOUND, `Entity ${id} not found.`);
  }
  return c.json(ok(entity), 200);
}

/** DELETE /entities/:id */
export async function deleteEntityHandler(c: GraphContext) {
  const id = c.req.param('id')!;
  const deleted = await c.var.situation.deleteEntity(tenant(c), id);
  return c.json(ok({ deleted }), 200);
}

/** GET /situation/:id?depth=1 */
export async function situationHandler(c: GraphContext) {
  const id = c.req.param('id')!;
  const depth = parseInt(c.req.query('depth') ?? '1', 10);
  const view = await c.var.situation.view(tenant(c), id, depth);
  return c.json(ok(view), 200);
}

/** POST /graph/explore  body: ExploreRequest */
export async function exploreHandler(c: GraphContext) {
  const body = (await c.req.json()) as ExploreRequest;
  const items = await c.var.situation.explore(tenant(c), body);
  return c.json(ok(items), 200);
}

/** POST /graph/query  body: CypherQueryRequest  (admin only) */
export async function cypherHandler(c: GraphContext) {
  // Admin check is enforced by the Gateway; here we re-verify the role.
  const { role } = getAuthContext(c);
  if (role !== 'admin') {
    throwError(ERROR_CODES.AUTH_FORBIDDEN, 'Admin role required for custom Cypher.');
  }
  const body = (await c.req.json()) as CypherQueryRequest;
  const rows = await c.var.repo.runCypher(tenant(c), body.statement, body.parameters, body.limit);
  return c.json(ok(rows), 200);
}
