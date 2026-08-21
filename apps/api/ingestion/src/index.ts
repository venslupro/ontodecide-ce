/**
 * Ingestion Service Worker entry point.
 *
 * Exports:
 *   - `fetch`    : HTTP entry for sync/file/webhook routes and job polling.
 *   - `queue`    : Async ETL consumer driven by the `ingestion-queue`.
 *
 * The `max_retries`/`dead_letter_queue` settings live in `wrangler.toml`
 * and are managed by the platform.
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
  configKey,
  ingestJobEnqueuedSchema,
  ingestSyncResultSchema,
  ingestSyncSchema,
  validateAndLogConfig,
  validators,
  type ConfigKey,
} from '@ontodecide/shared';
import type {IngestionEnv, IngestJobMessage} from './types/env.js';
import {
  fileIngestHandler,
  jobStatusHandler,
  syncIngestHandler,
  webhookHandler,
} from './handlers/ingestion.js';
import {handleQueueBatch} from './queue/consumer.js';

/** Zod schema for the job-status record returned by GET /ingest/jobs/:id. */
const jobRecordSchema = z.object({
  jobId: z.string().openapi({description: 'Id of the ingestion job.'}),
  tenantId: z.string().openapi({description: 'Owning tenant id.'}),
  status: z
      .enum(['queued', 'running', 'succeeded', 'failed'])
      .openapi({description: 'Current lifecycle status of the job.'}),
  format: z.string().openapi({description: 'Source format of the file.'}),
  ontologyType: z
      .string()
      .openapi({description: 'Ontology type the records map onto.'}),
  objectKey: z
      .string()
      .openapi({description: 'R2 object key of the staged file.'}),
  accepted: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .openapi({description: 'Number of records accepted.'}),
  rejected: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .openapi({description: 'Number of records rejected.'}),
  error: z.string().optional().openapi({description: 'Error message on failure.'}),
  startedAt: z
      .string()
      .optional()
      .openapi({description: 'ISO-8601 start timestamp.'}),
  finishedAt: z
      .string()
      .optional()
      .openapi({description: 'ISO-8601 finish timestamp.'}),
});

const app = new OpenAPIHono<{Bindings: IngestionEnv}>({
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

/** Cache config validation result — runs once per Worker instance. */
let configValidated = false;

const REQUIRED_KEYS: ConfigKey[] = [
  configKey('B2_KEY_ID', 'B2 Application Key ID', validators.nonEmpty),
  configKey('B2_KEY', 'B2 Application Key Secret', validators.nonEmpty),
  configKey('B2_REGION', 'B2 region (e.g. us-west-004)', validators.pattern(/^us-\w+-\d+$/, 'B2 region format like us-west-004')),
  configKey('B2_INGESTION_BUCKET', 'B2 ingestion staging bucket name', validators.nonEmpty),
  configKey('INGEST_QUEUE', 'Queue producer for async ETL jobs'),
  configKey('JOBS', 'KV namespace for job-status records'),
  configKey('GRAPH_SERVICE', 'Service Binding to Graph Worker'),
];
const OPTIONAL_KEYS: ConfigKey[] = [
  configKey('GRAPH_SERVICE_URL', 'Fallback URL for Graph Service (dev only)', validators.url()),
];

// Config validation middleware — runs once per Worker instance.
app.use('*', async (c, next) => {
  if (!configValidated) {
    validateAndLogConfig(
      c.env as unknown as Record<string, unknown>,
      REQUIRED_KEYS,
      OPTIONAL_KEYS,
      'ingestion',
    );
    configValidated = true;
  }
  await next();
});

// Public webhook callbacks bypass the internal-only guard; every other
// route must come through the Gateway (x-internal-call: 1 header).
app.use('*', internalOnlyMiddleware(['/ingest/webhook']));
app.onError(honoErrorHandler);
app.notFound((c) =>
  jsonFailResponse(c, ERROR_CODES.NOT_FOUND, 'Route not found.', 404),
);

// OpenAPI spec + Swagger UI.
app.doc('/openapi.json', (c) => ({
  openapi: '3.0.0',
  info: {
    title: 'Ingestion Service API',
    version: '0.1.0',
    description: 'Sync, async and webhook ingestion for OntoDecide.',
  },
  servers: [{url: new URL(c.req.url).origin}],
}));
app.get('/docs', (c) =>
  c.html(swaggerUiHtml(`${new URL(c.req.url).origin}/openapi.json`)),
);

// GET /healthz — plain route (not part of the OpenAPI spec).
app.get('/healthz', (c) =>
  jsonOkResponse(c, {service: 'ingestion', version: '0.1.0'}),
);

// POST /ingest/sync
const syncIngestRoute = createRoute({
  method: 'post',
  path: '/ingest/sync',
  request: {
    body: {
      content: {'application/json': {schema: ingestSyncSchema}},
    },
  },
  responses: {
    200: jsonOk(ingestSyncResultSchema, 'Sync ingestion result.'),
    400: jsonError('Validation failed.'),
    403: jsonError('Forbidden.'),
    413: jsonError('Payload too large.'),
  },
});
app.openapi(syncIngestRoute, syncIngestHandler);

// POST /ingest/file — multipart upload, async path.
const fileIngestRoute = createRoute({
  method: 'post',
  path: '/ingest/file',
  responses: {
    202: jsonOk(ingestJobEnqueuedSchema, 'Async job enqueued.'),
    400: jsonError('Validation failed.'),
    403: jsonError('Forbidden.'),
  },
});
app.openapi(fileIngestRoute, fileIngestHandler);

// POST /ingest/webhook — same body as sync; source defaults to "webhook".
const webhookRoute = createRoute({
  method: 'post',
  path: '/ingest/webhook',
  request: {
    body: {
      content: {'application/json': {schema: ingestSyncSchema}},
    },
  },
  responses: {
    200: jsonOk(ingestSyncResultSchema, 'Webhook ingestion result.'),
    400: jsonError('Validation failed.'),
    403: jsonError('Forbidden.'),
    413: jsonError('Payload too large.'),
  },
});
app.openapi(webhookRoute, webhookHandler);

// GET /ingest/jobs/:id — poll the status of an async job.
const jobStatusRoute = createRoute({
  method: 'get',
  path: '/ingest/jobs/{id}',
  request: {
    params: z.object({id: z.string()}),
  },
  responses: {
    200: jsonOk(jobRecordSchema, 'Job status record.'),
    400: jsonError('Validation failed.'),
    403: jsonError('Forbidden.'),
    404: jsonError('Job not found.'),
  },
});
app.openapi(jobStatusRoute, jobStatusHandler);

export default {
  fetch: app.fetch,
  async queue(
      batch: MessageBatch<IngestJobMessage>,
      env: IngestionEnv,
  ): Promise<void> {
    await handleQueueBatch(batch, env);
  },
};

/** Minimal Swagger UI page that loads the OpenAPI spec from the given URL. */
function swaggerUiHtml(specUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Ingestion Service API</title>
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
