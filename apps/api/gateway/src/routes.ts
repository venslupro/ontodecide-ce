/**
 * Route table mapping URL prefixes to downstream service base URLs.
 *
 * The Gateway uses a longest-prefix match so `/api/admin/cleanup` (Cleanup)
 * is preferred over `/api/admin/users` (User) when the prefixes overlap.
 *
 * The `registerOpenApiSpec` helper registers OpenAPI metadata for every
 * proxied endpoint so the Gateway can serve a complete `/openapi.json` spec
 * and Swagger UI at `/docs` — even though the actual handlers live in the
 * downstream services.
 */
import {z} from '@hono/zod-openapi';
import {type OpenAPIHono, jsonOk, jsonError} from '@ontodecide/shared/hono';
import {
  loginSchema,
  refreshSchema,
  authTokensSchema,
  authTokensWithActivationSchema,
  accountApplicationSchema,
  applicationResultSchema,
  changePasswordSchema,
  userPublicSchema,
  createUserSchema,
  credentialResultSchema,
  paginatedResponseSchema,
  pageQuerySchema,
  exploreRequestSchema,
  situationNodeSchema,
  entityNodeSchema,
  ontologyTypeSchema,
  ingestPayloadSchema,
  ingestSyncSchema,
  ingestFileSchema,
  ingestSyncResultSchema,
  ingestJobEnqueuedSchema,
  cypherQueryRequestSchema,
  scenarioRequestSchema,
  scenarioResultSchema,
  recommendationRequestSchema,
  recommendationSchema,
  agentPlanRequestSchema,
  agentStateSchema,
  cleanupRequestSchema,
  cleanupStatusSchema,
} from '@ontodecide/shared';
import type {GatewayEnv} from './types/env.js';

export interface RouteTarget {
  /** URL prefix matched against `request.pathname`. */
  prefix: string;
  /**
   * Resolve the downstream Service Binding.
   * Gateway uses Worker Service Bindings for zero-cost, in-account calls —
   * no public DNS, no external-request billing, implicit trust.
   */
  binding: (env: GatewayEnv) => Fetcher;
}

/**
 * Routes are evaluated in order; the first prefix match wins.
 * Keep more specific prefixes above their parents.
 */
export const ROUTES: readonly RouteTarget[] = [
  // Public auth routes — no JWT required, but they are rate-limited.
  {prefix: '/api/auth/', binding: (env) => env.USER_SERVICE},
  // Public account application — no JWT required, rate-limited.
  {prefix: '/api/applications', binding: (env) => env.USER_SERVICE},
  // Admin operations: cleanup routes belong to Cleanup service.
  {prefix: '/api/admin/cleanup', binding: (env) => env.CLEANUP_SERVICE},
  // User admin routes belong to User service.
  {prefix: '/api/admin/users', binding: (env) => env.USER_SERVICE},
  // Other admin routes (config, audit) also go to User service.
  {prefix: '/api/admin/', binding: (env) => env.USER_SERVICE},
  // Graph service handles all `/api/graph/*` and `/api/ontology*` calls.
  {prefix: '/api/graph', binding: (env) => env.GRAPH_SERVICE},
  {prefix: '/api/ontology', binding: (env) => env.GRAPH_SERVICE},
  {prefix: '/api/entities', binding: (env) => env.GRAPH_SERVICE},
  {prefix: '/api/situation', binding: (env) => env.GRAPH_SERVICE},
  // Ingestion service.
  {prefix: '/api/ingest', binding: (env) => env.INGESTION_SERVICE},
  // AI service.
  {prefix: '/api/ai/', binding: (env) => env.AI_SERVICE},
  // User profile (self).
  {prefix: '/api/user', binding: (env) => env.USER_SERVICE},
];

/** Routes that bypass JWT verification (still rate-limited). */
export const PUBLIC_PREFIXES: readonly string[] = [
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/applications',
];

/** Routes that require the `admin` role. */
export const ADMIN_PREFIXES: readonly string[] = [
  '/api/admin/',
];

// ---------------------------------------------------------------------------
// OpenAPI metadata for proxied routes.
//
// The Gateway forwards every request to a downstream service, so these
// `registerPath` calls exist purely to generate a complete OpenAPI spec.
// No actual Hono route is created — the catch-all forward handler in
// `index.ts` processes every `/api/*` request.
// ---------------------------------------------------------------------------

/** Bearer JWT security requirement applied to protected routes. */
const BEARER_AUTH = [{Bearer: []}];

/** Path-parameter schema for a generic `{id}` segment. */
const idParam = z.object({
  id: z.string().openapi({param: {name: 'id', in: 'path'}}),
});

/** Path-parameter schema for a `{taskId}` segment. */
const taskIdParam = z.object({
  taskId: z.string().openapi({param: {name: 'taskId', in: 'path'}}),
});

/**
 * Register OpenAPI metadata for every proxied endpoint.
 *
 * Call once on the app's `openAPIRegistry` after creating the
 * `OpenAPIHono` instance.
 */
export function registerOpenApiSpec(
    registry: OpenAPIHono['openAPIRegistry'],
): void {
  // Bearer security scheme used by all protected routes.
  registry.registerComponent('securitySchemes', 'Bearer', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'JWT Bearer token issued by the auth endpoint.',
  });

  // --- Auth (public, rate-limited) ----------------------------------------
  registry.registerPath({
    method: 'post',
    path: '/api/auth/login',
    tags: ['Auth'],
    security: [],
    summary: 'Login with username and password',
    request: {
      body: {content: {'application/json': {schema: loginSchema}}},
    },
    responses: {
      200: jsonOk(authTokensWithActivationSchema, 'Tokens issued (may require password change).'),
      401: jsonError('Invalid credentials.'),
      403: jsonError('Account expired.'),
      429: jsonError('Rate limit exceeded.'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/refresh',
    tags: ['Auth'],
    security: [],
    summary: 'Refresh access token',
    request: {
      body: {content: {'application/json': {schema: refreshSchema}}},
    },
    responses: {
      200: jsonOk(authTokensSchema, 'Tokens issued.'),
      401: jsonError('Invalid or expired refresh token.'),
      429: jsonError('Rate limit exceeded.'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/logout',
    tags: ['Auth'],
    security: BEARER_AUTH,
    summary: 'Logout and revoke the current token',
    responses: {
      200: jsonOk(z.object({success: z.boolean()}), 'Logged out.'),
      401: jsonError('Authentication required.'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/change-password',
    tags: ['Auth'],
    security: BEARER_AUTH,
    summary: 'Change password (first-login activation)',
    request: {
      body: {content: {'application/json': {schema: changePasswordSchema}}},
    },
    responses: {
      200: jsonOk(authTokensSchema, 'Password changed, full tokens issued.'),
      400: jsonError('Validation failed.'),
      401: jsonError('Current password incorrect.'),
      403: jsonError('Missing identity headers.'),
    },
  });

  // --- Public account application -----------------------------------------
  registry.registerPath({
    method: 'post',
    path: '/api/applications',
    tags: ['Auth'],
    security: [],
    summary: 'Submit an account application',
    request: {
      body: {content: {'application/json': {schema: accountApplicationSchema}}},
    },
    responses: {
      201: jsonOk(applicationResultSchema, 'Account created.'),
      400: jsonError('Validation failed.'),
      409: jsonError('Email already registered or max users reached.'),
      429: jsonError('Rate limit exceeded.'),
    },
  });

  // --- User (self-service) -----------------------------------------------
  registry.registerPath({
    method: 'get',
    path: '/api/user/profile',
    tags: ['User'],
    security: BEARER_AUTH,
    summary: 'Get the current user profile',
    responses: {
      200: jsonOk(userPublicSchema, 'Current user profile.'),
      401: jsonError('Authentication required.'),
    },
  });

  // --- Admin: Users -------------------------------------------------------
  registry.registerPath({
    method: 'get',
    path: '/api/admin/users',
    tags: ['Admin', 'Users'],
    security: BEARER_AUTH,
    summary: 'List users (paginated)',
    request: {query: pageQuerySchema},
    responses: {
      200: jsonOk(paginatedResponseSchema(userPublicSchema), 'User list.'),
      403: jsonError('Admin role required.'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/admin/users',
    tags: ['Admin', 'Users'],
    security: BEARER_AUTH,
    summary: 'Create a new user',
    request: {
      body: {content: {'application/json': {schema: createUserSchema}}},
    },
    responses: {
      200: jsonOk(credentialResultSchema, 'User created with temp password.'),
      403: jsonError('Admin role required.'),
      409: jsonError('Username already exists.'),
    },
  });

  registry.registerPath({
    method: 'put',
    path: '/api/admin/users/{id}/status',
    tags: ['Admin', 'Users'],
    security: BEARER_AUTH,
    summary: 'Update user active status',
    request: {
      params: idParam,
      body: {
        content: {
          'application/json': {
            schema: z.object({
              is_active: z.boolean().openapi({description: 'New state.'}),
            }),
          },
        },
      },
    },
    responses: {
      200: jsonOk(userPublicSchema, 'Updated user.'),
      403: jsonError('Admin role required.'),
      404: jsonError('User not found.'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/admin/users/{id}/reset',
    tags: ['Admin', 'Users'],
    security: BEARER_AUTH,
    summary: 'Reset user password',
    request: {params: idParam},
    responses: {
      200: jsonOk(credentialResultSchema, 'New temp password.'),
      403: jsonError('Admin role required.'),
      404: jsonError('User not found.'),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/admin/users/{id}',
    tags: ['Admin', 'Users'],
    security: BEARER_AUTH,
    summary: 'Delete a user',
    request: {params: idParam},
    responses: {
      200: jsonOk(z.object({success: z.boolean()}), 'User deleted.'),
      403: jsonError('Admin role required.'),
      404: jsonError('User not found.'),
    },
  });

  // --- Admin: Audit & Config ---------------------------------------------
  registry.registerPath({
    method: 'get',
    path: '/api/admin/audit',
    tags: ['Admin', 'Audit'],
    security: BEARER_AUTH,
    summary: 'List audit log entries (paginated)',
    request: {query: pageQuerySchema},
    responses: {
      200: jsonOk(z.array(z.unknown()), 'Audit entries.'),
      403: jsonError('Admin role required.'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/admin/config',
    tags: ['Admin', 'Config'],
    security: BEARER_AUTH,
    summary: 'List system configuration',
    responses: {
      200: jsonOk(z.array(z.unknown()), 'Config entries.'),
      403: jsonError('Admin role required.'),
    },
  });

  registry.registerPath({
    method: 'put',
    path: '/api/admin/config',
    tags: ['Admin', 'Config'],
    security: BEARER_AUTH,
    summary: 'Update a configuration value',
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              key: z.string().openapi({description: 'Config key.'}),
              value: z.string().openapi({description: 'New value.'}),
            }),
          },
        },
      },
    },
    responses: {
      200: jsonOk(z.unknown(), 'Updated config entry.'),
      403: jsonError('Admin role required.'),
    },
  });

  // --- Graph --------------------------------------------------------------
  registry.registerPath({
    method: 'get',
    path: '/api/ontology',
    tags: ['Graph', 'Ontology'],
    security: BEARER_AUTH,
    summary: 'List ontology types',
    responses: {
      200: jsonOk(z.array(ontologyTypeSchema), 'Ontology types.'),
      401: jsonError('Authentication required.'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/ontology',
    tags: ['Graph', 'Ontology'],
    security: BEARER_AUTH,
    summary: 'Create or update an ontology type',
    request: {
      body: {content: {'application/json': {schema: ontologyTypeSchema}}},
    },
    responses: {
      200: jsonOk(ontologyTypeSchema, 'Ontology type saved.'),
      401: jsonError('Authentication required.'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/entities',
    tags: ['Graph', 'Entities'],
    security: BEARER_AUTH,
    summary: 'Find entities by type or attribute',
    request: {query: pageQuerySchema},
    responses: {
      200: jsonOk(z.array(entityNodeSchema), 'Matching entities.'),
      401: jsonError('Authentication required.'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/entities',
    tags: ['Graph', 'Entities'],
    security: BEARER_AUTH,
    summary: 'Upsert entities and relations',
    request: {
      body: {content: {'application/json': {schema: ingestPayloadSchema}}},
    },
    responses: {
      200: jsonOk(z.object({success: z.boolean()}), 'Entities upserted.'),
      401: jsonError('Authentication required.'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/entities/{id}',
    tags: ['Graph', 'Entities'],
    security: BEARER_AUTH,
    summary: 'Get a single entity by id',
    request: {params: idParam},
    responses: {
      200: jsonOk(situationNodeSchema, 'Entity with relations.'),
      401: jsonError('Authentication required.'),
      404: jsonError('Entity not found.'),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/entities/{id}',
    tags: ['Graph', 'Entities'],
    security: BEARER_AUTH,
    summary: 'Delete an entity',
    request: {params: idParam},
    responses: {
      200: jsonOk(z.object({success: z.boolean()}), 'Entity deleted.'),
      401: jsonError('Authentication required.'),
      404: jsonError('Entity not found.'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/situation/{id}',
    tags: ['Graph', 'Situation'],
    security: BEARER_AUTH,
    summary: 'Get the situation view for an entity',
    request: {params: idParam},
    responses: {
      200: jsonOk(situationNodeSchema, 'Situation view.'),
      401: jsonError('Authentication required.'),
      404: jsonError('Entity not found.'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/graph/explore',
    tags: ['Graph'],
    security: BEARER_AUTH,
    summary: 'Explore the graph from a root entity',
    request: {
      body: {
        content: {'application/json': {schema: exploreRequestSchema}},
      },
    },
    responses: {
      200: jsonOk(z.array(situationNodeSchema), 'Explored sub-graph.'),
      401: jsonError('Authentication required.'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/graph/query',
    tags: ['Graph'],
    security: BEARER_AUTH,
    summary: 'Run a custom Cypher query (admin only)',
    request: {
      body: {
        content: {
          'application/json': {schema: cypherQueryRequestSchema},
        },
      },
    },
    responses: {
      200: jsonOk(z.array(z.unknown()), 'Query results.'),
      401: jsonError('Authentication required.'),
      403: jsonError('Admin role required.'),
    },
  });

  // --- Ingestion ----------------------------------------------------------
  registry.registerPath({
    method: 'post',
    path: '/api/ingest/sync',
    tags: ['Ingestion'],
    security: BEARER_AUTH,
    summary: 'Synchronously ingest a small payload',
    request: {
      body: {content: {'application/json': {schema: ingestSyncSchema}}},
    },
    responses: {
      200: jsonOk(ingestSyncResultSchema, 'Ingestion result.'),
      401: jsonError('Authentication required.'),
      413: jsonError('Payload too large.'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/ingest/file',
    tags: ['Ingestion'],
    security: BEARER_AUTH,
    summary: 'Enqueue async file ingestion',
    request: {
      body: {content: {'application/json': {schema: ingestFileSchema}}},
    },
    responses: {
      200: jsonOk(ingestJobEnqueuedSchema, 'Job enqueued.'),
      401: jsonError('Authentication required.'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/ingest/webhook',
    tags: ['Ingestion'],
    security: [],
    summary: 'Webhook callback for ingestion',
    responses: {
      200: jsonOk(z.object({success: z.boolean()}), 'Webhook processed.'),
      401: jsonError('Invalid signature.'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/ingest/jobs/{id}',
    tags: ['Ingestion'],
    security: BEARER_AUTH,
    summary: 'Get ingestion job status',
    request: {params: idParam},
    responses: {
      200: jsonOk(z.unknown(), 'Job status.'),
      401: jsonError('Authentication required.'),
      404: jsonError('Job not found.'),
    },
  });

  // --- AI -----------------------------------------------------------------
  registry.registerPath({
    method: 'get',
    path: '/api/ai/providers',
    tags: ['AI'],
    security: BEARER_AUTH,
    summary: 'List available LLM providers',
    responses: {
      200: jsonOk(z.array(z.string()), 'Provider ids.'),
      401: jsonError('Authentication required.'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/ai/scenario',
    tags: ['AI'],
    security: BEARER_AUTH,
    summary: 'Generate scenario simulations',
    request: {
      body: {
        content: {'application/json': {schema: scenarioRequestSchema}},
      },
    },
    responses: {
      200: jsonOk(scenarioResultSchema, 'Generated scenarios.'),
      401: jsonError('Authentication required.'),
      429: jsonError('Neuron budget exceeded.'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/ai/recommend',
    tags: ['AI'],
    security: BEARER_AUTH,
    summary: 'Generate recommendations',
    request: {
      body: {
        content: {
          'application/json': {schema: recommendationRequestSchema},
        },
      },
    },
    responses: {
      200: jsonOk(recommendationSchema, 'Recommendation.'),
      401: jsonError('Authentication required.'),
      429: jsonError('Neuron budget exceeded.'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/ai/agent/plan',
    tags: ['AI'],
    security: BEARER_AUTH,
    summary: 'Start a planning-agent task',
    request: {
      body: {
        content: {'application/json': {schema: agentPlanRequestSchema}},
      },
    },
    responses: {
      200: jsonOk(agentStateSchema, 'Agent state.'),
      401: jsonError('Authentication required.'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/ai/agent/{id}',
    tags: ['AI'],
    security: BEARER_AUTH,
    summary: 'Get planning-agent state',
    request: {params: idParam},
    responses: {
      200: jsonOk(agentStateSchema, 'Agent state.'),
      401: jsonError('Authentication required.'),
      404: jsonError('Agent not found.'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/ai/agent/{id}/reflect',
    tags: ['AI'],
    security: BEARER_AUTH,
    summary: 'Trigger agent reflection',
    request: {params: idParam},
    responses: {
      200: jsonOk(agentStateSchema, 'Updated agent state.'),
      401: jsonError('Authentication required.'),
      404: jsonError('Agent not found.'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/ai/history',
    tags: ['AI'],
    security: BEARER_AUTH,
    summary: 'List past decisions (paginated)',
    request: {query: pageQuerySchema},
    responses: {
      200: jsonOk(z.array(z.unknown()), 'Decision history.'),
      401: jsonError('Authentication required.'),
    },
  });

  // --- Cleanup ------------------------------------------------------------
  registry.registerPath({
    method: 'post',
    path: '/api/admin/cleanup',
    tags: ['Admin', 'Cleanup'],
    security: BEARER_AUTH,
    summary: 'Trigger a data cleanup run',
    request: {
      body: {
        content: {'application/json': {schema: cleanupRequestSchema}},
      },
    },
    responses: {
      200: jsonOk(cleanupStatusSchema, 'Cleanup task status.'),
      403: jsonError('Admin role required.'),
      409: jsonError('A cleanup is already running.'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/admin/cleanup/status/{taskId}',
    tags: ['Admin', 'Cleanup'],
    security: BEARER_AUTH,
    summary: 'Get cleanup task status',
    request: {params: taskIdParam},
    responses: {
      200: jsonOk(cleanupStatusSchema, 'Cleanup task status.'),
      403: jsonError('Admin role required.'),
      404: jsonError('Task not found.'),
    },
  });
}
