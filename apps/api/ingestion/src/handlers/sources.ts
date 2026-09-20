/**
 * Data-source management handlers for the "Sync Connectors" page.
 *
 *   GET    /ingest/sources                — list all sources for the tenant.
 *   POST   /ingest/sources                — create a new source record.
 *   DELETE /ingest/sources/:id            — delete a source record.
 *   POST   /ingest/sources/:id/test       — ping the source URL (HEAD, 5s).
 *   PUT    /ingest/sources/:id/schedule   — update the cron schedule.
 *
 * Records are stored in the `SOURCES` KV namespace under the key
 * `ingest:source:<tenantId>:<sourceId>` so they are tenant-scoped.
 */
import type { Context } from 'hono';
import { ERROR_CODES, HEADERS, fail, nowIso, ok, uuid } from '@ontodecide/shared';
import type { DataSourceRecord, IngestionEnv } from '../types/env.js';

/** KV key prefix for source records (per-tenant scoping follows the prefix). */
const SOURCE_KEY_PREFIX = 'ingest:source:';

/** Test connection timeout in milliseconds (5 seconds). */
const TEST_TIMEOUT_MS = 5000;

/** GET /ingest/sources — list all data sources for the current tenant. */
export async function listSourcesHandler(c: Context) {
  const env = c.env as IngestionEnv;
  const tenantId = c.req.header(HEADERS.TENANT_ID);
  if (!tenantId) {
    return c.json(fail(ERROR_CODES.AUTH_FORBIDDEN, 'Missing tenant id.'), 403);
  }
  const prefix = SOURCE_KEY_PREFIX + tenantId + ':';
  const list = await env.SOURCES.list({ prefix });
  const sources: DataSourceRecord[] = [];
  for (const key of list.keys) {
    const record = await env.SOURCES.get<DataSourceRecord>(key.name, 'json');
    if (record) {
      sources.push(record);
    }
  }
  return c.json(ok(sources), 200);
}

/** POST /ingest/sources — create a new data source. */
export async function createSourceHandler(c: Context) {
  const env = c.env as IngestionEnv;
  const tenantId = c.req.header(HEADERS.TENANT_ID);
  if (!tenantId) {
    return c.json(fail(ERROR_CODES.AUTH_FORBIDDEN, 'Missing tenant id.'), 403);
  }
  const body = (await c.req.json()) as {
    name: string;
    kind: 'csv' | 'json' | 'parquet' | 'webhook';
    url: string;
    auth?: string;
    cron?: string;
    timezone?: string;
    scheduleEnabled?: boolean;
  };
  if (!body.name || !body.kind || !body.url) {
    return c.json(fail(ERROR_CODES.VALIDATION_FAILED, 'name, kind and url are required.'), 400);
  }
  const sourceId = uuid();
  const record: DataSourceRecord = {
    sourceId,
    tenantId,
    name: body.name,
    kind: body.kind,
    url: body.url,
    auth: body.auth ?? '',
    status: 'healthy',
    cron: body.cron,
    timezone: body.timezone,
    scheduleEnabled: body.scheduleEnabled ?? false,
    createdAt: nowIso(),
  };
  await env.SOURCES.put(SOURCE_KEY_PREFIX + tenantId + ':' + sourceId, JSON.stringify(record));
  return c.json(ok(record), 201);
}

/** DELETE /ingest/sources/:id — delete a data source. */
export async function deleteSourceHandler(c: Context) {
  const env = c.env as IngestionEnv;
  const tenantId = c.req.header(HEADERS.TENANT_ID);
  if (!tenantId) {
    return c.json(fail(ERROR_CODES.AUTH_FORBIDDEN, 'Missing tenant id.'), 403);
  }
  const sourceId = c.req.param('id');
  const key = SOURCE_KEY_PREFIX + tenantId + ':' + sourceId;
  const record = await env.SOURCES.get<DataSourceRecord>(key, 'json');
  if (!record) {
    return c.json(fail(ERROR_CODES.NOT_FOUND, `Source ${sourceId} not found.`), 404);
  }
  await env.SOURCES.delete(key);
  return c.json(ok({ sourceId, deleted: true }), 200);
}

/** POST /ingest/sources/:id/test — probe the source URL with a HEAD request. */
export async function testSourceHandler(c: Context) {
  const env = c.env as IngestionEnv;
  const tenantId = c.req.header(HEADERS.TENANT_ID);
  if (!tenantId) {
    return c.json(fail(ERROR_CODES.AUTH_FORBIDDEN, 'Missing tenant id.'), 403);
  }
  const sourceId = c.req.param('id');
  const key = SOURCE_KEY_PREFIX + tenantId + ':' + sourceId;
  const record = await env.SOURCES.get<DataSourceRecord>(key, 'json');
  if (!record) {
    return c.json(fail(ERROR_CODES.NOT_FOUND, `Source ${sourceId} not found.`), 404);
  }
  const start = Date.now();
  try {
    const response = await fetch(record.url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - start;
    const isOk = response.ok;
    return c.json(
      ok({
        ok: isOk,
        latencyMs,
        message: isOk
          ? `Reachable (${response.status}).`
          : `Responded with status ${response.status}.`,
      }),
      200,
    );
  } catch (err) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : 'Unknown error.';
    return c.json(ok({ ok: false, latencyMs, message }), 200);
  }
}

/** PUT /ingest/sources/:id/schedule — update the cron schedule for a source. */
export async function updateScheduleHandler(c: Context) {
  const env = c.env as IngestionEnv;
  const tenantId = c.req.header(HEADERS.TENANT_ID);
  if (!tenantId) {
    return c.json(fail(ERROR_CODES.AUTH_FORBIDDEN, 'Missing tenant id.'), 403);
  }
  const sourceId = c.req.param('id');
  const key = SOURCE_KEY_PREFIX + tenantId + ':' + sourceId;
  const record = await env.SOURCES.get<DataSourceRecord>(key, 'json');
  if (!record) {
    return c.json(fail(ERROR_CODES.NOT_FOUND, `Source ${sourceId} not found.`), 404);
  }
  const body = (await c.req.json()) as {
    cron: string;
    timezone: string;
    scheduleEnabled: boolean;
  };
  const updated: DataSourceRecord = {
    ...record,
    cron: body.cron,
    timezone: body.timezone,
    scheduleEnabled: body.scheduleEnabled,
  };
  await env.SOURCES.put(key, JSON.stringify(updated));
  return c.json(ok(updated), 200);
}
