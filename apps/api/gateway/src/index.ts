/**
 * Gateway Worker entry point.
 *
 * Responsibilities (per design doc §4.1):
 *   1. Verify the Bearer JWT (or allow public auth routes).
 *   2. Enforce per-tenant rate limits.
 *   3. Inject identity headers (`x-tenant-id`, `x-user-id`, `x-user-role`).
 *   4. Forward to the downstream service and stream the response back.
 *
 * The Gateway keeps no business state — it is intentionally stateless and
 * relies on KV only for the JWT blacklist and rate-limit counters.
 */
import {ERROR_CODES} from '@ontodecide/shared';
import {
  OpenAPIHono,
  jsonOkResponse,
  jsonFailResponse,
  honoErrorHandler,
} from '@ontodecide/shared/hono';
import type {GatewayEnv} from './types/env.js';
import {ROUTES, registerOpenApiSpec} from './routes.js';
import {authMiddleware, type GatewayVariables} from './middlewares/auth.js';
import {rateLimitMiddleware} from './middlewares/ratelimit.js';
import {forwardRequest} from './forward.js';

type AppEnv = {
  Bindings: GatewayEnv;
  Variables: GatewayVariables;
};

const app = new OpenAPIHono<AppEnv>();

// Global error handler — translates thrown ApiErrorImpl into the standard
// JSON envelope.
app.onError(honoErrorHandler);

// 404 handler for unmatched routes.
app.notFound((c) =>
  jsonFailResponse(c, ERROR_CODES.NOT_FOUND, 'Route not found.', 404),
);

// Health check.
app.get('/healthz', (c) =>
  jsonOkResponse(c, {service: 'ontodecide-gateway', version: '0.1.0'}),
);

// Root info (non-/api/ root).
app.get('/', (c) =>
  jsonOkResponse(c, {service: 'ontodecide-gateway', version: '0.1.0'}),
);

// Auth + rate-limit middleware for every proxied request.
app.use('/api/*', authMiddleware, rateLimitMiddleware);

// Catch-all forward handler — every /api/* request is proxied to the
// matching downstream service via a Service Binding (zero-cost, in-account).
app.all('/api/*', async (c) => {
  const path = new URL(c.req.url).pathname;
  const route = matchRoute(path);
  if (!route) {
    return jsonFailResponse(
        c,
        ERROR_CODES.NOT_FOUND,
        `No route for ${path}`,
        404,
    );
  }
  const auth = c.get('auth');
  const binding = route.binding(c.env);
  try {
    return await forwardRequest(c.req.raw, binding, auth);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Downstream call failed';
    return jsonFailResponse(c, ERROR_CODES.INTERNAL, message, 502);
  }
});

// OpenAPI metadata for all proxied routes (documentation only — the actual
// forwarding is handled by the catch-all above).
registerOpenApiSpec(app.openAPIRegistry);

// OpenAPI spec endpoint.
app.doc('/openapi.json', (c) => ({
  openapi: '3.0.0',
  info: {
    title: 'OntoDecide Gateway API',
    version: '0.1.0',
    description:
      'API Gateway that authenticates, rate-limits, and forwards' +
      ' requests to downstream services.',
  },
  servers: [{url: new URL(c.req.url).origin}],
}));

/** Minimal Swagger UI page pointing at `/openapi.json`. */
const SWAGGER_UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OntoDecide Gateway API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.onload = () => SwaggerUIBundle({
      url: '/openapi.json',
      dom_id: '#swagger-ui',
    });
  </script>
</body>
</html>`;

// Swagger UI.
app.get('/docs', (c) => c.html(SWAGGER_UI_HTML));

export default {
  fetch: app.fetch,
  // The Gateway has no cron trigger; it is invoked only via `fetch`.
  async scheduled(): Promise<void> {
    // Intentionally a no-op. Cron triggers are owned by the Cleanup Worker.
  },
};

/**
 * Pick the downstream route for `path`.
 * Visible for testing.
 */
export function matchRoute(path: string): (typeof ROUTES)[number] | undefined {
  return ROUTES.find((r) => path === r.prefix || path.startsWith(ensureTrailingSlash(r.prefix)));
}

function ensureTrailingSlash(prefix: string): string {
  return prefix.endsWith('/') ? prefix : prefix + '/';
}
