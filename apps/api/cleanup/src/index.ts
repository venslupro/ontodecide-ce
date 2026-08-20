/**
 * Cleanup Service Worker entry point.
 *
 * Three exports:
 *   - `fetch`     — admin endpoints (POST /cleanup, GET /cleanup/status/:id)
 *   - `scheduled` — daily cron trigger (03:00 UTC, see wrangler.toml)
 *   - `queue`     — consumer for `cleanup-queue`
 *
 * The cron path is the design doc's §4.6 main flow; the queue consumer
 * executes the per-tenant purge (multi-step: Neo4j → D1 → KV → R2 → mark).
 */
import {z} from 'zod';
import {
  OpenAPIHono,
  createRoute,
  honoErrorHandler,
  internalOnlyMiddleware,
  jsonError,
  jsonFailResponse,
  jsonOk,
  jsonOkResponse,
} from '@ontodecide/shared/hono';
import {
  ERROR_CODES,
  cleanupRequestSchema,
  cleanupStatusSchema,
} from '@ontodecide/shared';
import type {CleanupEnv, CleanupMessage} from './types/env.js';
import {
  cleanupStatusHandler,
  triggerCleanupHandler,
} from './handlers/admin.js';
import {runDailyCleanup} from './cron/trigger.js';
import {handleCleanupBatch} from './queue/consumer.js';

const app = new OpenAPIHono<{Bindings: CleanupEnv}>({
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

// All Cleanup routes are internal-only (called by the Gateway).
app.use('*', internalOnlyMiddleware());
app.onError(honoErrorHandler);
app.notFound((c) =>
  jsonFailResponse(c, ERROR_CODES.NOT_FOUND, 'Route not found.', 404),
);

// GET /healthz — plain route (not part of the OpenAPI spec).
app.get('/healthz', (c) =>
  jsonOkResponse(c, {service: 'cleanup', version: '0.1.0'}),
);

// POST /cleanup
const triggerCleanupRoute = createRoute({
  method: 'post',
  path: '/cleanup',
  request: {
    body: {
      content: {'application/json': {schema: cleanupRequestSchema}},
    },
  },
  responses: {
    202: jsonOk(z.object({taskId: z.string()}), 'Cleanup task enqueued.'),
    400: jsonError('Validation failed.'),
    403: jsonError('Forbidden.'),
  },
});
app.openapi(triggerCleanupRoute, triggerCleanupHandler);

// GET /cleanup/status/:id
const cleanupStatusRoute = createRoute({
  method: 'get',
  path: '/cleanup/status/{id}',
  request: {
    params: z.object({id: z.string()}),
  },
  responses: {
    200: jsonOk(cleanupStatusSchema, 'Cleanup task status.'),
    400: jsonError('Validation failed.'),
    403: jsonError('Forbidden.'),
    404: jsonError('Task not found.'),
  },
});
app.openapi(cleanupStatusRoute, cleanupStatusHandler);

// OpenAPI spec + Swagger UI.
app.doc('/openapi.json', (c) => ({
  openapi: '3.0.0',
  info: {
    title: 'Cleanup Service API',
    version: '0.1.0',
    description: 'Daily data-retention enforcement + manual purge.',
  },
  servers: [{url: new URL(c.req.url).origin}],
}));
app.get('/docs', (c) =>
  c.html(swaggerUiHtml(`${new URL(c.req.url).origin}/openapi.json`)),
);

export default {
  fetch: app.fetch,
  async scheduled(
      _event: ScheduledEvent,
      env: CleanupEnv,
      ctx: ExecutionContext,
  ): Promise<void> {
    // Use `waitUntil` so the cron invocation can return immediately and
    // let the platform bill the work to the cron request's CPU budget.
    ctx.waitUntil(runDailyCleanup(env).catch((err) => {
      // In production, surface this to a log stream; the prototype just
      // swallows the error so the cron keeps firing daily.
      void err;
    }));
  },

  async queue(
      batch: MessageBatch<CleanupMessage>,
      env: CleanupEnv,
  ): Promise<void> {
    await handleCleanupBatch(batch, env);
  },
};

/** Minimal Swagger UI page that loads the OpenAPI spec from the given URL. */
function swaggerUiHtml(specUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Cleanup Service API</title>
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
