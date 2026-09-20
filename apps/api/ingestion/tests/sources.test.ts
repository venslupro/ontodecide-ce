/**
 * Unit tests for data-source management handlers.
 *
 * Covers:
 *   (a) listSources  — empty list, populated list, missing tenant header
 *   (b) createSource — success, validation error, missing tenant header
 *   (c) deleteSource — success, not-found, missing tenant header
 *   (d) testSource   — reachable, unreachable, not-found
 *   (e) updateSchedule — success, not-found, missing tenant header
 *
 * A minimal in-memory KV mock and a Hono Context mock are used so the
 * handlers run in isolation without a running Worker.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DataSourceRecord, IngestionEnv } from '../src/types/env.js';
import { HEADERS } from '@ontodecide/shared';
import {
  listSourcesHandler,
  createSourceHandler,
  deleteSourceHandler,
  testSourceHandler,
  updateScheduleHandler,
} from '../src/handlers/sources.js';

// ---------------------------------------------------------------------------
// Mock KV namespace
// ---------------------------------------------------------------------------

class MockKV implements Partial<KVNamespace> {
  private store = new Map<string, string>();

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async get<T>(key: string, type?: 'text' | 'json'): Promise<T | null> {
    const raw = this.store.get(key);
    if (raw === undefined) return null;
    if (type === 'json') return JSON.parse(raw) as T;
    return raw as T;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list({ prefix }: { prefix?: string } = {}): Promise<{
    keys: Array<{ name: string }>;
  }> {
    const keys: Array<{ name: string }> = [];
    for (const key of this.store.keys()) {
      if (!prefix || key.startsWith(prefix)) {
        keys.push({ name: key });
      }
    }
    return { keys };
  }
}

// ---------------------------------------------------------------------------
// Mock Hono Context builder
// ---------------------------------------------------------------------------

function makeCtx(
  opts: {
    tenantId?: string | null;
    body?: unknown;
    params?: Record<string, string>;
    method?: string;
  } = {},
) {
  const kv = new MockKV();
  const env = { SOURCES: kv } as unknown as IngestionEnv;

  const headers = new Map<string, string>();
  if (opts.tenantId !== null) {
    headers.set(HEADERS.TENANT_ID, opts.tenantId ?? 'tenant-1');
  }

  const ctx = {
    env,
    req: {
      header: (name: string) => headers.get(name.toLowerCase()),
      param: (name: string) => opts.params?.[name] ?? '',
      json: async () => opts.body ?? {},
    },
    json: (body: unknown, status: number) => {
      const res = {
        status,
        body,
      };
      // Attach a helper for tests to extract data.
      (res as unknown as { _data: unknown })._data = body;
      return res;
    },
  };

  return { ctx: ctx as unknown as Parameters<typeof listSourcesHandler>[0], kv, env };
}

// ---------------------------------------------------------------------------
// Helper: insert a source record directly into KV for setup.
// ---------------------------------------------------------------------------

async function seedSource(
  kv: MockKV,
  tenantId: string,
  sourceId: string,
  overrides: Partial<DataSourceRecord> = {},
): Promise<DataSourceRecord> {
  const record: DataSourceRecord = {
    sourceId,
    tenantId,
    name: 'Test Source',
    kind: 'json',
    url: 'https://example.com/api',
    auth: 'bearer',
    status: 'healthy',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  await kv.put(
    `ingest:source:${tenantId}:${sourceId}`,
    JSON.stringify(record),
  );
  return record;
}

/** Extract the response body object from the Hono mock return value. */
function getBody(res: unknown): { success: boolean; data?: unknown; error?: { code: string; message: string } } {
  return (res as { _data: unknown })._data as ReturnType<typeof getBody>;
}

// ---------------------------------------------------------------------------
// (a) listSources
// ---------------------------------------------------------------------------

describe('listSourcesHandler', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an empty array when no sources exist', async () => {
    const { ctx } = makeCtx();
    const res = await listSourcesHandler(ctx);
    const body = getBody(res);
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  it('returns all sources for the current tenant', async () => {
    const { ctx, kv } = makeCtx({ tenantId: 'tenant-1' });
    await seedSource(kv, 'tenant-1', 'src-a', { name: 'Source A' });
    await seedSource(kv, 'tenant-1', 'src-b', { name: 'Source B' });
    // Another tenant's source should not appear.
    await seedSource(kv, 'tenant-2', 'src-c', { name: 'Source C' });

    const res = await listSourcesHandler(ctx);
    const body = getBody(res);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    const names = (body.data as DataSourceRecord[]).map((s) => s.name);
    expect(names).toContain('Source A');
    expect(names).toContain('Source B');
    expect(names).not.toContain('Source C');
  });

  it('returns 403 when tenant header is missing', async () => {
    const { ctx } = makeCtx({ tenantId: null });
    const res = await listSourcesHandler(ctx);
    expect(getBody(res).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (b) createSource
// ---------------------------------------------------------------------------

describe('createSourceHandler', () => {
  it('creates a source and stores it in KV', async () => {
    const { ctx, kv } = makeCtx({
      body: {
        name: 'My API',
        kind: 'json',
        url: 'https://example.com/data',
        auth: 'bearer',
      },
    });
    const res = await createSourceHandler(ctx);
    const body = getBody(res);
    expect(body.success).toBe(true);
    const record = body.data as DataSourceRecord;
    expect(record.sourceId).toBeTruthy();
    expect(record.name).toBe('My API');
    expect(record.kind).toBe('json');
    expect(record.status).toBe('healthy');
    expect(record.tenantId).toBe('tenant-1');

    // Verify it was persisted.
    const list = await kv.list({ prefix: 'ingest:source:tenant-1:' });
    expect(list.keys).toHaveLength(1);
  });

  it('returns 400 when required fields are missing', async () => {
    const { ctx } = makeCtx({
      body: { name: 'Incomplete', kind: 'json' },
    });
    const res = await createSourceHandler(ctx);
    const body = getBody(res);
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('VALIDATION_FAILED');
  });

  it('returns 403 when tenant header is missing', async () => {
    const { ctx } = makeCtx({ tenantId: null, body: { name: 'X', kind: 'csv', url: 'https://x' } });
    const res = await createSourceHandler(ctx);
    expect(getBody(res).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (c) deleteSource
// ---------------------------------------------------------------------------

describe('deleteSourceHandler', () => {
  it('deletes an existing source', async () => {
    const { ctx, kv } = makeCtx({ params: { id: 'src-a' } });
    await seedSource(kv, 'tenant-1', 'src-a');

    const res = await deleteSourceHandler(ctx);
    const body = getBody(res);
    expect(body.success).toBe(true);
    expect((body.data as { sourceId: string }).sourceId).toBe('src-a');

    // Verify it was removed.
    const list = await kv.list({ prefix: 'ingest:source:tenant-1:' });
    expect(list.keys).toHaveLength(0);
  });

  it('returns 404 when source does not exist', async () => {
    const { ctx } = makeCtx({ params: { id: 'nonexistent' } });
    const res = await deleteSourceHandler(ctx);
    const body = getBody(res);
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it('returns 403 when tenant header is missing', async () => {
    const { ctx } = makeCtx({ tenantId: null, params: { id: 'x' } });
    const res = await deleteSourceHandler(ctx);
    expect(getBody(res).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (d) testSource
// ---------------------------------------------------------------------------

describe('testSourceHandler', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns ok=true when the URL is reachable', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
    })) as typeof fetch;

    const { ctx, kv } = makeCtx({ params: { id: 'src-a' } });
    await seedSource(kv, 'tenant-1', 'src-a', { url: 'https://example.com/ok' });

    const res = await testSourceHandler(ctx);
    const body = getBody(res);
    expect(body.success).toBe(true);
    const result = body.data as { ok: boolean; latencyMs: number; message: string };
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.message).toContain('200');
  });

  it('returns ok=false when the URL responds with an error status', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
    })) as typeof fetch;

    const { ctx, kv } = makeCtx({ params: { id: 'src-a' } });
    await seedSource(kv, 'tenant-1', 'src-a');

    const res = await testSourceHandler(ctx);
    const body = getBody(res);
    const result = body.data as { ok: boolean; message: string };
    expect(result.ok).toBe(false);
    expect(result.message).toContain('503');
  });

  it('returns ok=false when fetch throws', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Network unreachable.');
    }) as typeof fetch;

    const { ctx, kv } = makeCtx({ params: { id: 'src-a' } });
    await seedSource(kv, 'tenant-1', 'src-a');

    const res = await testSourceHandler(ctx);
    const body = getBody(res);
    const result = body.data as { ok: boolean; message: string };
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Network unreachable');
  });

  it('returns 404 when source does not exist', async () => {
    const { ctx } = makeCtx({ params: { id: 'nope' } });
    const res = await testSourceHandler(ctx);
    expect(getBody(res).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (e) updateSchedule
// ---------------------------------------------------------------------------

describe('updateScheduleHandler', () => {
  it('updates the cron schedule for an existing source', async () => {
    const { ctx, kv } = makeCtx({
      params: { id: 'src-a' },
      body: { cron: '0 8 * * *', timezone: 'UTC', scheduleEnabled: true },
    });
    await seedSource(kv, 'tenant-1', 'src-a');

    const res = await updateScheduleHandler(ctx);
    const body = getBody(res);
    expect(body.success).toBe(true);
    const record = body.data as DataSourceRecord;
    expect(record.cron).toBe('0 8 * * *');
    expect(record.timezone).toBe('UTC');
    expect(record.scheduleEnabled).toBe(true);
  });

  it('returns 404 when source does not exist', async () => {
    const { ctx } = makeCtx({
      params: { id: 'nonexistent' },
      body: { cron: '0 8 * * *', timezone: 'UTC', scheduleEnabled: true },
    });
    const res = await updateScheduleHandler(ctx);
    expect(getBody(res).success).toBe(false);
  });

  it('returns 403 when tenant header is missing', async () => {
    const { ctx } = makeCtx({
      tenantId: null,
      params: { id: 'x' },
      body: { cron: '0 8 * * *', timezone: 'UTC', scheduleEnabled: true },
    });
    const res = await updateScheduleHandler(ctx);
    expect(getBody(res).success).toBe(false);
  });
});
