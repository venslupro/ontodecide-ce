/**
 * Graph Service Worker entry point.
 *
 * Wires up the Neo4j repository, the application services, and the HTTP
 * handlers on a Hono + @hono/zod-openapi router. Identity headers
 * (`x-tenant-id`, `x-user-role`) are trusted because the Worker only accepts
 * internal calls from the Gateway (enforced by `internalOnlyMiddleware`).
 */
import {
  OpenAPIHono,
  createRoute,
  honoErrorHandler,
  internalOnlyMiddleware,
  jsonError,
  jsonOk,
  jsonFailResponse,
  jsonOkResponse,
} from '@ontodecide/shared/hono';
import {
  ERROR_CODES,
  configKey,
  cypherQueryRequestSchema,
  entityNodeSchema,
  exploreRequestSchema,
  ingestPayloadSchema,
  ontologyTypeSchema,
  situationNodeSchema,
  validateAndLogConfig,
  validators,
  type ConfigKey,
} from '@ontodecide/shared';
import {z} from 'zod';
import type {GraphEnv} from './types/env.js';
import {Neo4jRepository} from './repository/neo4j.repository.js';
import {OntologyService} from './service/ontology.service.js';
import {SituationService} from './service/situation.service.js';
import {EntityService} from './service/entity.service.js';
import {
  type GraphVars,
  cypherHandler,
  deleteEntityHandler,
  exploreHandler,
  findEntitiesHandler,
  findEntityHandler,
  listOntologyHandler,
  situationHandler,
  upsertEntitiesHandler,
  upsertOntologyHandler,
} from './handlers/graph.js';

const app = new OpenAPIHono<{Bindings: GraphEnv; Variables: GraphVars}>({
  // Translate Zod validation failures into the standard error envelope.
  // On success, return `undefined` so @hono/zod-validator proceeds to the
  // handler; on failure, return the 400 envelope to short-circuit it.
  defaultHook: (result, c) =>
    result.success ?
      undefined :
      jsonFailResponse(
          c,
          ERROR_CODES.VALIDATION_FAILED,
          'Validation failed.',
          400,
      ),
});

/** Cache config validation result — runs once per Worker instance. */
let configValidated = false;

const REQUIRED_KEYS = [
  configKey('CACHE', 'KV cache namespace for ontology + entity caches'),
  configKey('NEO4J_URL', 'Neo4j AuraDB connection URL', validators.url),
  configKey('NEO4J_USER', 'Neo4j username (usually "neo4j")', validators.nonEmpty),
  configKey('NEO4J_PASSWORD', 'Neo4j password', validators.minLength(1)),
  configKey('NEO4J_DATABASE', 'Neo4j database name', validators.nonEmpty),
];
const OPTIONAL_KEYS: ConfigKey[] = [];

// Config validation middleware — runs once per Worker instance.
app.use('*', async (c, next) => {
  if (!configValidated) {
    validateAndLogConfig(
      c.env as unknown as Record<string, unknown>,
      REQUIRED_KEYS,
      OPTIONAL_KEYS,
      'graph',
    );
    configValidated = true;
  }
  await next();
});

// Gateway-only: reject direct calls except for the OpenAPI docs.
app.use('*', internalOnlyMiddleware(['/docs', '/openapi.json']));

// Build per-request service bindings from the Cloudflare env.
// Skip for documentation/health routes so OpenAPI spec generation works
// without a fully-configured env (e.g. NEO4J_URL may be absent).
const DOC_AND_HEALTH_PATHS = ['/docs', '/openapi.json', '/healthz'];
app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (DOC_AND_HEALTH_PATHS.includes(path)) {
    await next();
    return;
  }
  const repo = new Neo4jRepository(c.env);
  c.set('repo', repo);
  c.set('ontology', new OntologyService(repo, c.env.CACHE));
  c.set('situation', new SituationService(repo, c.env.CACHE));
  c.set('entities', new EntityService(repo));
  await next();
});

// OpenAPI spec + Swagger UI.
app.doc('/openapi.json', (c) => ({
  openapi: '3.0.0',
  info: {
    title: 'Graph Service API',
    version: '0.1.0',
    description: 'Ontology, entity, and situation-view endpoints.',
  },
  servers: [{url: new URL(c.req.url).origin}],
}));
app.get('/docs', (c) => c.html(swaggerUiHtml('/openapi.json')));

// Health check.
app.get('/healthz', (c) =>
  jsonOkResponse(c, {service: 'graph', version: '0.1.0'}),
);

// Routes (Gateway strips the /api prefix; paths are root-relative here).
const listOntologyRoute = createRoute({
  method: 'get',
  path: '/ontology',
  responses: {
    200: jsonOk(z.array(ontologyTypeSchema), 'Tenant ontology types.'),
    400: jsonError('Validation failed.'),
  },
});

const upsertOntologyRoute = createRoute({
  method: 'post',
  path: '/ontology',
  request: {
    body: {
      content: {'application/json': {schema: ontologyTypeSchema}},
      required: true,
    },
  },
  responses: {
    200: jsonOk(z.object({success: z.boolean()}), 'Ontology type upserted.'),
    400: jsonError('Validation failed.'),
    403: jsonError('Forbidden.'),
  },
});

const upsertEntitiesRoute = createRoute({
  method: 'post',
  path: '/entities',
  request: {
    body: {
      content: {'application/json': {schema: ingestPayloadSchema}},
      required: true,
    },
  },
  responses: {
    200: jsonOk(z.object({accepted: z.number().int()}), 'Entities upserted.'),
    400: jsonError('Validation failed.'),
    403: jsonError('tenant_id mismatch.'),
  },
});

const findEntitiesRoute = createRoute({
  method: 'get',
  path: '/entities',
  request: {
    query: z.object({type: z.string().optional()}),
  },
  responses: {
    200: jsonOk(z.array(entityNodeSchema), 'Matching entities.'),
    400: jsonError('Validation failed.'),
  },
});

const findEntityRoute = createRoute({
  method: 'get',
  path: '/entities/{id}',
  request: {
    params: z.object({id: z.string()}),
  },
  responses: {
    200: jsonOk(entityNodeSchema, 'The entity.'),
    400: jsonError('Validation failed.'),
    404: jsonError('Entity not found.'),
  },
});

const deleteEntityRoute = createRoute({
  method: 'delete',
  path: '/entities/{id}',
  request: {
    params: z.object({id: z.string()}),
  },
  responses: {
    200: jsonOk(z.object({deleted: z.number().int()}), 'Entities deleted.'),
    400: jsonError('Validation failed.'),
  },
});

const situationRoute = createRoute({
  method: 'get',
  path: '/situation/{id}',
  request: {
    params: z.object({id: z.string()}),
    query: z.object({
      depth: z.string().openapi({description: 'Traversal depth (1..3).'}).optional(),
    }),
  },
  responses: {
    200: jsonOk(situationNodeSchema, 'Situation view.'),
    400: jsonError('Validation failed.'),
    404: jsonError('Entity not found.'),
  },
});

const exploreRoute = createRoute({
  method: 'post',
  path: '/graph/explore',
  request: {
    body: {
      content: {'application/json': {schema: exploreRequestSchema}},
      required: true,
    },
  },
  responses: {
    200: jsonOk(z.array(situationNodeSchema), 'Exploration result.'),
    400: jsonError('Validation failed.'),
  },
});

const cypherRoute = createRoute({
  method: 'post',
  path: '/graph/query',
  request: {
    body: {
      content: {'application/json': {schema: cypherQueryRequestSchema}},
      required: true,
    },
  },
  responses: {
    200: jsonOk(z.array(z.object({}).passthrough()), 'Query rows.'),
    400: jsonError('Validation failed.'),
    403: jsonError('Admin role required.'),
  },
});

app.openapi(listOntologyRoute, listOntologyHandler);
app.openapi(upsertOntologyRoute, upsertOntologyHandler);
app.openapi(upsertEntitiesRoute, upsertEntitiesHandler);
app.openapi(findEntitiesRoute, findEntitiesHandler);
app.openapi(findEntityRoute, findEntityHandler);
app.openapi(deleteEntityRoute, deleteEntityHandler);
app.openapi(situationRoute, situationHandler);
app.openapi(exploreRoute, exploreHandler);
app.openapi(cypherRoute, cypherHandler);

app.notFound((c) =>
  jsonFailResponse(c, ERROR_CODES.NOT_FOUND, 'Route not found.', 404),
);
app.onError(honoErrorHandler);

export default {
  async fetch(request: Request, env: GraphEnv): Promise<Response> {
    return app.fetch(request, env);
  },
};

/** Minimal Swagger UI page (served from a CDN) pointing at the OpenAPI spec. */
function swaggerUiHtml(specUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Graph Service API</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" charset="utf-8"></script>
<script>
window.onload = () => {
  SwaggerUIBundle({url: '${specUrl}', dom_id: '#swagger-ui'});
};
</script>
</body>
</html>`;
}
