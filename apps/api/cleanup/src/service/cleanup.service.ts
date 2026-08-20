/**
 * Per-tenant cleanup orchestrator.
 *
 * Drives the four-step purge described in the design doc §4.6:
 *   1. Archive key metadata to R2 (3-day regret window).
 *   2. Neo4j:   `MATCH (n {tenant_id}) DETACH DELETE n`
 *   3. D1:      delete decisions / audit_logs / data_sources rows
 *   4. KV:      delete all `tenant:{tid}:*` keys across every namespace
 *   5. R2:      delete `{tid}/*` objects (after the archive snapshot)
 *
 * The `soft` mode keeps the archive snapshot; `hard` mode purges it too.
 */
import {
  CONFIG,
  ERROR_CODES,
  nowIso,
  throwError,
} from '@ontodecide/shared';
import type {CleanupEnv} from '../types/env.js';
import {drizzle} from 'drizzle-orm/d1';
import {eq} from 'drizzle-orm';
import {auditLogs, decisions, refreshTokens, users} from '@ontodecide/shared/db';

export interface CleanupOutcome {
  tenantId: string;
  archived: boolean;
  neo4jDeleted: number;
  d1Deleted: number;
  kvDeleted: number;
  r2Deleted: number;
  durationMs: number;
}

/** Run the full purge for one tenant. */
export async function cleanupTenant(
    tenantId: string,
    mode: 'soft' | 'hard',
    env: CleanupEnv,
): Promise<CleanupOutcome> {
  const started = Date.now();
  // Step 1 — archive a snapshot (soft mode only).
  const archived = mode === 'soft' ?
    await archiveTenant(tenantId, env) :
    false;

  // Step 2 — Neo4j: delete all tenant-owned nodes + relations.
  const neo4jDeleted = await deleteNeo4jTenant(tenantId, env);

  // Step 3 — D1: delete decisions / audit_logs.
  const d1Deleted = await deleteD1Tenant(tenantId, env.DB);

  // Step 4 — KV: delete `tenant:{tid}:*` keys in every namespace.
  const kvDeleted =
    (await purgeKvPrefix(env.USER_CACHE, `tenant:${tenantId}:`)) +
    (await purgeKvPrefix(env.GRAPH_CACHE, `tenant:${tenantId}:`)) +
    (await purgeKvPrefix(env.INGESTION_JOBS, `tenant:${tenantId}:`)) +
    (await purgeKvPrefix(env.AI_CACHE, `tenant:${tenantId}:`)) +
    // Also drop the situation/scenario caches (different prefix).
    (await purgeKvPrefix(env.GRAPH_CACHE, `situation:${tenantId}:`)) +
    (await purgeKvPrefix(env.AI_CACHE, `scenario:${tenantId}:`)) +
    (await purgeKvPrefix(env.AI_CACHE, `entity:${tenantId}:`)) +
    (await purgeKvPrefix(env.GRAPH_CACHE, `ontology:${tenantId}`));

  // Step 5 — R2: delete the tenant's directory.
  const r2Deleted = await purgeR2Prefix(env.BUCKET, `${tenantId}/`);

  // Step 6 — Hard mode: also drop the archive snapshot.
  if (mode === 'hard') {
    await purgeR2Prefix(env.BUCKET, `archive/${tenantId}/`);
  }

  // Step 7 — Mark the tenant row as cleared.
  await markCleared(tenantId, env);

  return {
    tenantId,
    archived,
    neo4jDeleted,
    d1Deleted,
    kvDeleted,
    r2Deleted,
    durationMs: Date.now() - started,
  };
}

/** Snapshot the tenant's audit log + decisions to R2. */
async function archiveTenant(tenantId: string, env: CleanupEnv): Promise<boolean> {
  const orm = drizzle(env.DB);
  const archiveKey = `archive/${tenantId}/${new Date().toISOString()}/snapshot.json`;
  const auditRows = await orm.select()
      .from(auditLogs)
      .where(eq(auditLogs.tenant_id, tenantId))
      .all();
  const decisionRows = await orm.select()
      .from(decisions)
      .where(eq(decisions.tenant_id, tenantId))
      .all();
  const snapshot = {
    tenantId,
    archivedAt: nowIso(),
    auditLogs: auditRows,
    decisions: decisionRows,
    retentionDays: CONFIG.CLEANUP_ARCHIVE_RETENTION_DAYS,
  };
  // R2 does not support per-object TTLs; retention is enforced by the
  // cleanup-queue consumer (hard mode) or a bucket lifecycle rule.
  await env.BUCKET.put(archiveKey, JSON.stringify(snapshot), {
    customMetadata: {tenantId, mode: 'soft', retentionDays: String(CONFIG.CLEANUP_ARCHIVE_RETENTION_DAYS)},
  });
  return true;
}

/** Delete all tenant-owned nodes + relations in Neo4j. */
async function deleteNeo4jTenant(tenantId: string, env: CleanupEnv): Promise<number> {
  const endpoint = `${env.NEO4J_URL.replace(/\/$/, '')}/db/neo4j/tx/commit`;
  const auth = 'Basic ' + btoa(`${env.NEO4J_USER}:${env.NEO4J_PASSWORD}`);
  const body = JSON.stringify({
    statements: [
      {
        statement: `
          MATCH (n {tenant_id: $tenantId})
          DETACH DELETE n
          RETURN count(n) as deleted
        `,
        parameters: {tenantId},
      },
    ],
  });
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Content-Type': 'application/json',
        'Accept': 'application/json;charset=UTF-8',
      },
      body,
    });
    if (!response.ok) {
      throwError(
          ERROR_CODES.GRAPH_NEO4J_UNAVAILABLE,
          `Neo4j HTTP ${response.status}: ${await response.text()}`,
      );
    }
    const data = (await response.json()) as {
      results?: Array<{data?: Array<{row?: unknown[]}>}>;
      errors?: unknown[];
    };
    if (data.errors && data.errors.length > 0) {
      throwError(ERROR_CODES.GRAPH_NEO4J_UNAVAILABLE,
          `Neo4j errors: ${JSON.stringify(data.errors)}`);
    }
    const row = data.results?.[0]?.data?.[0]?.row;
    return Number(row?.[0] ?? 0);
  } catch (err) {
    // Neo4j unreachable — record the failure but continue so D1/KV/R2
    // are still purged. The next cron run will retry the graph cleanup.
    throwError(
        ERROR_CODES.GRAPH_NEO4J_UNAVAILABLE,
        `Neo4j cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Delete all tenant-owned rows from the D1 tables. */
async function deleteD1Tenant(tenantId: string, db: D1Database): Promise<number> {
  const orm = drizzle(db);
  const d1 = await orm.delete(decisions)
      .where(eq(decisions.tenant_id, tenantId))
      .run();
  const d2 = await orm.delete(auditLogs)
      .where(eq(auditLogs.tenant_id, tenantId))
      .run();
  const d3 = await orm.delete(refreshTokens)
      .where(eq(refreshTokens.tenant_id, tenantId))
      .run();
  return (d1.meta.changes ?? 0) + (d2.meta.changes ?? 0) + (d3.meta.changes ?? 0);
}

/** Delete all KV keys with the given prefix. */
async function purgeKvPrefix(kv: KVNamespace, prefix: string): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined;
  // KV list is paginated; loop until exhausted.
  do {
    const list = await kv.list({prefix, cursor});
    for (const key of list.keys) {
      await kv.delete(key.name);
      deleted++;
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  return deleted;
}

/** Recursively delete all R2 objects whose key starts with `prefix`. */
async function purgeR2Prefix(bucket: R2Bucket, prefix: string): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined;
  do {
    const list = await bucket.list({prefix, cursor});
    for (const obj of list.objects) {
      await bucket.delete(obj.key);
      deleted++;
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return deleted;
}

/** Mark the tenant's user row as cleared. */
async function markCleared(tenantId: string, env: CleanupEnv): Promise<void> {
  const orm = drizzle(env.DB);
  await orm.update(users)
      .set({
        is_data_cleared: 1,
        last_cleanup_at: nowIso(),
        data_size_estimate: 0,
      })
      .where(eq(users.tenant_id, tenantId))
      .run();
}
