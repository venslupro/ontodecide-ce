/**
 * User Service Worker entry point.
 *
 * Wires up the DDD layers (repository → service → handlers) and mounts
 * the HTTP routes using Hono + @hono/zod-openapi. The Gateway forwards
 * requests here; identity headers are trusted because the Worker only
 * accepts calls that carry the `x-internal-call` marker set by the
 * Gateway (public auth routes are exempted).
 */
import { z } from 'zod';
import {
  OpenAPIHono,
  createRoute,
  honoErrorHandler,
  internalOnlyMiddleware,
  jsonError,
  jsonFailResponse,
  jsonOk,
} from '@ontodecide/shared/hono';
import {
  ERROR_CODES,
  authTokensSchema,
  authTokensWithActivationSchema,
  accountApplicationSchema,
  applicationResultSchema,
  changePasswordSchema,
  configKey,
  createUserSchema,
  loginSchema,
  ok,
  refreshSchema,
  userPublicSchema,
  credentialResultSchema,
  validateAndLogConfig,
  validators,
} from '@ontodecide/shared';
import type { UserEnv } from './types/env.js';
import {
  D1AuditRepository,
  D1ConfigRepository,
  D1RefreshTokenRepository,
  D1UserRepository,
} from './repository/d1.user.repository.js';
import { UserManagementService } from './service/user.service.js';
import {
  loginHandler,
  logoutHandler,
  refreshHandler,
  changePasswordHandler,
} from './handlers/auth.js';
import { profileHandler } from './handlers/user.js';
import { submitApplicationHandler } from './handlers/application.js';
import {
  createUserHandler,
  deleteUserHandler,
  listAuditHandler,
  listConfigHandler,
  listUsersHandler,
  resetPasswordHandler,
  setConfigHandler,
  updateStatusHandler,
} from './handlers/admin.js';

/** Per-request variables injected by middleware. */
interface UserVars {
  service: UserManagementService;
}

type UserContext = {
  Bindings: UserEnv;
  Variables: UserVars;
};

/** Cache config validation result — runs once per Worker instance. */
let configValidated = false;

const REQUIRED_KEYS = [
  configKey(
    'JWT_SECRET',
    'HMAC-SHA256 signing key (≥32 chars, high entropy)',
    validators.jwtSecret(),
  ),
  configKey('DB', 'D1 database for users, audit_logs, refresh_tokens'),
  configKey('CACHE', 'KV cache namespace'),
];
const OPTIONAL_KEYS = [
  configKey('EMAIL_API_KEY', 'Resend API key for transactional emails'),
  configKey('EMAIL_FROM', 'Sender email address', validators.email),
];

const app = new OpenAPIHono<UserContext>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: {
            code: ERROR_CODES.VALIDATION_FAILED,
            message: 'Request validation failed.',
          },
        },
        400,
      );
    }
    return;
  },
});

// --- Middleware -----------------------------------------------------------

// Config validation middleware — runs once per Worker instance.
app.use('*', async (c, next) => {
  if (!configValidated) {
    validateAndLogConfig(
      c.env as unknown as Record<string, unknown>,
      REQUIRED_KEYS,
      OPTIONAL_KEYS,
      'user',
    );
    configValidated = true;
  }
  await next();
});

/** Allow auth + application routes through without the internal-call marker. */
app.use('*', internalOnlyMiddleware(['/auth/', '/applications']));

/** Create the DDD service layer per request from D1 + Neo4j bindings. */
app.use('*', async (c, next) => {
  const service = new UserManagementService(
    new D1UserRepository(c.env.DB),
    new D1AuditRepository(c.env.DB),
    new D1RefreshTokenRepository(c.env.DB),
    new D1ConfigRepository(c.env.DB),
    c.env, // NEO4J_URL / NEO4J_USER / NEO4J_PASSWORD bindings
  );
  c.set('service', service);
  await next();
});

app.onError(honoErrorHandler);
app.notFound((c) => jsonFailResponse(c, ERROR_CODES.NOT_FOUND, 'Route not found.', 404));

// --- Security scheme -----------------------------------------------------

app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

// --- Routes ---------------------------------------------------------------

const healthRoute = createRoute({
  method: 'get',
  path: '/healthz',
  responses: {
    200: jsonOk(z.object({ service: z.string(), version: z.string() }), 'Service health.'),
  },
});
app.openapi(healthRoute, (c) =>
  c.json(ok({ service: 'user', version: '0.1.0' }, c.req.header('x-trace-id')), 200),
);

// Auth routes (public, rate-limited at the gateway).

const loginRoute = createRoute({
  method: 'post',
  path: '/auth/login',
  tags: ['Auth'],
  summary: 'Login with username + password',
  request: {
    body: {
      content: { 'application/json': { schema: loginSchema } },
    },
  },
  responses: {
    200: jsonOk(authTokensWithActivationSchema, 'Tokens issued (may require password change).'),
    400: jsonError('Validation failed.'),
    401: jsonError('Invalid credentials.'),
    403: jsonError('Account expired.'),
  },
});
app.openapi(loginRoute, async (c) => {
  const service = c.get('service');
  return loginHandler(c, c.env.JWT_SECRET, service);
});

const refreshRoute = createRoute({
  method: 'post',
  path: '/auth/refresh',
  tags: ['Auth'],
  summary: 'Rotate tokens with a refresh token',
  request: {
    body: {
      content: { 'application/json': { schema: refreshSchema } },
    },
  },
  responses: {
    200: jsonOk(authTokensSchema, 'New tokens issued.'),
    400: jsonError('Validation failed.'),
    401: jsonError('Token expired or invalid.'),
  },
});
app.openapi(refreshRoute, async (c) => {
  const service = c.get('service');
  return refreshHandler(c, c.env.JWT_SECRET, service);
});

const logoutRoute = createRoute({
  method: 'post',
  path: '/auth/logout',
  tags: ['Auth'],
  summary: 'Revoke the current refresh token',
  request: {
    body: {
      content: { 'application/json': { schema: refreshSchema } },
    },
  },
  responses: {
    200: jsonOk(z.object({ success: z.boolean() }), 'Logout acknowledged.'),
  },
});
app.openapi(logoutRoute, async (c) => {
  const service = c.get('service');
  return logoutHandler(c, c.env.JWT_SECRET, service);
});

const changePasswordRoute = createRoute({
  method: 'post',
  path: '/auth/change-password',
  tags: ['Auth'],
  summary: 'Change password (first-login activation)',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { 'application/json': { schema: changePasswordSchema } },
    },
  },
  responses: {
    200: jsonOk(authTokensSchema, 'Password changed, full tokens issued.'),
    400: jsonError('Validation failed.'),
    401: jsonError('Current password incorrect.'),
    403: jsonError('Missing identity headers.'),
  },
});
app.openapi(changePasswordRoute, async (c) => {
  const service = c.get('service');
  return changePasswordHandler(c, c.env.JWT_SECRET, service);
});

// Public account application route.

const applicationRoute = createRoute({
  method: 'post',
  path: '/applications',
  tags: ['Auth'],
  summary: 'Submit an account application',
  request: {
    body: {
      content: { 'application/json': { schema: accountApplicationSchema } },
    },
  },
  responses: {
    201: jsonOk(applicationResultSchema, 'Account created.'),
    400: jsonError('Validation failed.'),
    409: jsonError('Email already registered or max users reached.'),
  },
});
app.openapi(applicationRoute, async (c) => {
  const service = c.get('service');
  return submitApplicationHandler(c, service);
});

// Self-service routes.

const profileRoute = createRoute({
  method: 'get',
  path: '/user/profile',
  tags: ['User'],
  summary: 'Get the current user profile',
  security: [{ bearerAuth: [] }],
  responses: {
    200: jsonOk(userPublicSchema, 'User profile.'),
    403: jsonError('Missing identity headers.'),
  },
});
app.openapi(profileRoute, async (c) => {
  const service = c.get('service');
  return profileHandler(c, service);
});

// Admin: users.

const listUsersRoute = createRoute({
  method: 'get',
  path: '/admin/users',
  tags: ['Admin'],
  summary: 'List users (paginated)',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      page: z.string().optional().openapi({ description: 'Page number.' }),
      size: z.string().optional().openapi({ description: 'Page size.' }),
      role: z.string().optional().openapi({ description: 'Filter by role.' }),
    }),
  },
  responses: {
    200: jsonOk(
      z.object({
        total: z.number(),
        page: z.number(),
        size: z.number(),
        list: z.array(userPublicSchema),
      }),
      'Paginated user list.',
    ),
  },
});
app.openapi(listUsersRoute, async (c) => {
  const service = c.get('service');
  return listUsersHandler(c, service);
});

const createUserRoute = createRoute({
  method: 'post',
  path: '/admin/users',
  tags: ['Admin'],
  summary: 'Create a new user',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { 'application/json': { schema: createUserSchema } },
    },
  },
  responses: {
    201: jsonOk(credentialResultSchema, 'User created.'),
    400: jsonError('Validation failed.'),
    409: jsonError('Username already exists or max users reached.'),
  },
});
app.openapi(createUserRoute, async (c) => {
  const service = c.get('service');
  return createUserHandler(c, service);
});

const updateStatusRoute = createRoute({
  method: 'put',
  path: '/admin/users/{id}/status',
  tags: ['Admin'],
  summary: 'Enable or disable a user',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().openapi({ description: 'User id.' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            is_active: z.boolean(),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonOk(userPublicSchema, 'Updated user.'),
    400: jsonError('Validation failed.'),
    404: jsonError('User not found.'),
  },
});
app.openapi(updateStatusRoute, async (c) => {
  const service = c.get('service');
  return updateStatusHandler(c, c.req.param('id'), service);
});

const resetPasswordRoute = createRoute({
  method: 'post',
  path: '/admin/users/{id}/reset',
  tags: ['Admin'],
  summary: 'Reset a user password',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().openapi({ description: 'User id.' }),
    }),
  },
  responses: {
    200: jsonOk(
      z.object({
        temporary_password: z.string(),
      }),
      'New temporary password.',
    ),
    404: jsonError('User not found.'),
  },
});
app.openapi(resetPasswordRoute, async (c) => {
  const service = c.get('service');
  return resetPasswordHandler(c, c.req.param('id'), service);
});

const deleteUserRoute = createRoute({
  method: 'delete',
  path: '/admin/users/{id}',
  tags: ['Admin'],
  summary: 'Soft-delete a user',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().openapi({ description: 'User id.' }),
    }),
  },
  responses: {
    200: jsonOk(z.object({ success: z.boolean() }), 'User deleted.'),
    403: jsonError('Cannot delete the bootstrap admin.'),
    404: jsonError('User not found.'),
  },
});
app.openapi(deleteUserRoute, async (c) => {
  const service = c.get('service');
  return deleteUserHandler(c, c.req.param('id'), service);
});

// Admin: audit + config.

const listAuditRoute = createRoute({
  method: 'get',
  path: '/admin/audit',
  tags: ['Admin'],
  summary: 'List audit log entries',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      page: z.string().optional(),
      size: z.string().optional(),
    }),
  },
  responses: {
    200: jsonOk(
      z.object({
        total: z.number(),
        page: z.number(),
        size: z.number(),
        list: z.array(
          z.object({
            id: z.string(),
            tenantId: z.string(),
            operatorId: z.string(),
            action: z.string(),
            targetUserId: z.string().nullable(),
            details: z.string().nullable(),
            ip: z.string().nullable(),
            userAgent: z.string().nullable(),
            createdAt: z.string(),
          }),
        ),
      }),
      'Paginated audit log.',
    ),
    403: jsonError('Missing tenant id.'),
  },
});
app.openapi(listAuditRoute, async (c) => {
  const service = c.get('service');
  return listAuditHandler(c, service);
});

const listConfigRoute = createRoute({
  method: 'get',
  path: '/admin/config',
  tags: ['Admin'],
  summary: 'List system configuration',
  security: [{ bearerAuth: [] }],
  responses: {
    200: jsonOk(z.record(z.string(), z.string()), 'All configuration values.'),
  },
});
app.openapi(listConfigRoute, async (c) => {
  const service = c.get('service');
  return listConfigHandler(c, service);
});

const setConfigRoute = createRoute({
  method: 'put',
  path: '/admin/config',
  tags: ['Admin'],
  summary: 'Set a configuration value',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            key: z.string(),
            value: z.string(),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonOk(z.object({ success: z.boolean() }), 'Config updated.'),
    400: jsonError('Validation failed.'),
  },
});
app.openapi(setConfigRoute, async (c) => {
  const service = c.get('service');
  return setConfigHandler(c, service);
});

// --- OpenAPI spec + Swagger UI --------------------------------------------

app.doc('/openapi.json', (c) => ({
  openapi: '3.0.0',
  info: {
    title: 'OntoDecide User Service',
    version: '0.1.0',
    description: 'Account lifecycle, authentication, and audit logging.',
  },
  servers: [{ url: new URL(c.req.url).origin }],
}));

app.get('/docs', (c) => c.html(swaggerUiHtml(`${new URL(c.req.url).origin}/openapi.json`)));

// --- Worker export --------------------------------------------------------

export default {
  fetch: app.fetch,
};

/** Minimal Swagger UI page that loads the OpenAPI spec from the given URL. */
function swaggerUiHtml(specUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>OntoDecide User Service API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => SwaggerUIBundle({
      url: ${JSON.stringify(specUrl)},
      dom_id: '#swagger-ui',
    });
  </script>
</body>
</html>`;
}
