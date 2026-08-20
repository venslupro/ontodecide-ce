/**
 * Per-tenant cleanup orchestrator.
 *
 * Drives the purge pipeline described in the design doc §4.6:
 *   1. Archive user metadata to B2 tenant-archive bucket (backup).
 *      Includes: user record, audit logs, decisions, config snapshots.
 *   2. Neo4j:   `MATCH (n {tenant_id}) DETACH DELETE n`
 *   3. D1:      delete decisions / audit_logs / refresh_tokens rows
 *   4. KV:      delete all `tenant:{tid}:*` keys across every namespace
 *   5. B2:      delete `{tid}/*` objects from the ingestion staging bucket
 *   6. (hard + deleteAccount): delete the user account from D1
 *
 * The `soft` mode keeps the archive snapshot; `hard` mode also purges
 * the archive snapshot. When `deleteAccount` is true, the user's row
 * in the `users` table is permanently deleted (not just marked cleared).
 *
 * Backblaze B2 replaces Cloudflare R2 as the object storage:
 *   - Ingestion staging bucket  → transient uploads, purged on cleanup
 *   - Tenant archive bucket      → long-term metadata backup
 * Both buckets use the S3-compatible API with AWS SigV4 signing.
 */
import {
  CONFIG,
  ERROR_CODES,
  nowIso,
  throwError,
  type B2Client,
  createArchiveB2Client,
  createIngestionB2Client,
  dropTenantDbStatement,
} from '@ontodecide/shared';
import type {CleanupEnv} from '../types/env.js';
import {drizzle} from 'drizzle-orm/d1';
import {eq} from 'drizzle-orm';
import {auditLogs, decisions, refreshTokens, users, systemConfig} from '@ontodecide/shared/db';

export interface CleanupOutcome {
  tenantId: string;
  archived: boolean;
  neo4jDeleted: number;
  d1Deleted: number;
  kvDeleted: number;
  b2Deleted: number;
  accountDeleted: boolean;
  durationMs: number;
}

/** Run the full purge for one tenant. */
export async function cleanupTenant(
    tenantId: string,
    mode: 'soft' | 'hard',
    env: CleanupEnv,
    deleteAccount: boolean,
): Promise<CleanupOutcome> {
  const started = Date.now();
  const archiveClient = createArchiveB2Client(env);
  const ingestionClient = createIngestionB2Client(env);

  // Step 1 — archive user metadata to the B2 tenant-archive bucket.
  // Always archive (both soft and hard modes) so the user's metadata
  // survives even in hard-purge scenarios.
  const archived = await archiveUserMetadata(tenantId, env, archiveClient);

  // Step 2 — Neo4j: delete all tenant-owned nodes + relations.
  const neo4jDeleted = await deleteNeo4jTenant(tenantId, env);

  // Step 3 — D1: delete decisions / audit_logs / refresh_tokens.
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

  // Step 5 — B2: delete the tenant's objects from the ingestion bucket.
  const b2Deleted = await purgeB2Prefix(ingestionClient, `${tenantId}/`);

  // Step 6 — Hard mode: also purge the archive snapshot (except when
  // deleteAccount is true — in that case the archive is permanent for
  // compliance, and we delete the account row instead).
  if (mode === 'hard' && !deleteAccount) {
    await purgeB2Prefix(archiveClient, `archive/${tenantId}/`);
  }

  // Step 7 — Mark the tenant row as cleared (or delete the account).
  let accountDeleted = false;
  if (deleteAccount) {
    accountDeleted = await deleteTenantAccount(tenantId, env);
  } else {
    await markCleared(tenantId, env);
  }

  return {
    tenantId,
    archived,
    neo4jDeleted,
    d1Deleted,
    kvDeleted,
    b2Deleted,
    accountDeleted,
    durationMs: Date.now() - started,
  };
}

/**
 * Archive ALL user metadata to the B2 tenant-archive bucket before any
 * deletion. This includes:
 *   - The full user row (id, username, role, retention, timestamps)
 *   - All audit log entries for this tenant
 *   - All decisions created by this tenant
 *   - System config entries created by this tenant's admin
 *
 * The archive object key format:
 *   archive/<tenantId>/<ISO-timestamp>/user-metadata.json
 *
 * This is the COMPLIANCE BACKUP — it persists indefinitely (versioning
 * is enabled on the archive bucket) so that user metadata can be
 * retrieved even after the user account is fully deleted.
 */
async function archiveUserMetadata(
    tenantId: string,
    env: CleanupEnv,
    archiveClient: B2Client,
): Promise<boolean> {
  const orm = drizzle(env.DB);
  const archiveKey = `archive/${tenantId}/${new Date().toISOString()}/user-metadata.json`;

  // Collect all metadata that should survive the user's deletion.
  const userRows = await orm.select()
      .from(users)
      .where(eq(users.tenant_id, tenantId))
      .all();
  const auditRows = await orm.select()
      .from(auditLogs)
      .where(eq(auditLogs.tenant_id, tenantId))
      .all();
  const decisionRows = await orm.select()
      .from(decisions)
      .where(eq(decisions.tenant_id, tenantId))
      .all();
  const configRows = await orm.select()
      .from(systemConfig)
      .all();

  const snapshot = {
    tenantId,
    archivedAt: nowIso(),
    retentionDays: CONFIG.CLEANUP_ARCHIVE_RETENTION_DAYS,
    userRecords: userRows,
    auditLogs: auditRows,
    decisions: decisionRows,
    systemConfig: configRows,
  };

  await archiveClient.put(archiveKey, JSON.stringify(snapshot), {
    customMetadata: {
      tenantId,
      archiveType: 'user-metadata',
      archivedAt: nowIso(),
      retentionDays: String(CONFIG.CLEANUP_ARCHIVE_RETENTION_DAYS),
    },
    contentType: 'application/json',
  });
  return true;
}

/**
 * Drop the tenant's entire Neo4j logical database.
 *
 * This is a SINGLE SYSTEM-LEVEL command (DROP DATABASE) — it removes
 * ALL nodes, relationships, indexes, and constraints belonging to
 * the tenant in one atomic operation. Far faster and cleaner than
 * the previous `MATCH (n {tenant_id}) DETACH DELETE n` node-by-node
 * approach, which was vulnerable to partial deletes and
 * OOMs on large tenant graphs.
 *
 * Database names follow the convention in shared/utils/neo4j-db.ts
 * (tenant_<sanitized_tenantId>).
 */
async function deleteNeo4jTenant(tenantId: string, env: CleanupEnv): Promise<number> {
  const endpoint = `${env.NEO4J_URL.replace(/\/$/, '')}/db/system/tx/commit`;
  const auth = 'Basic ' + btoa(`${env.NEO4J_USER}:${env.NEO4J_PASSWORD}`);
  const body = JSON.stringify({
    statements: [{statement: dropTenantDbStatement(tenantId)}],
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
          `Neo4j DROP DATABASE HTTP ${response.status}: ${await response.text()}`,
      );
    }
    const data = (await response.json()) as {errors?: Array<{code: string; message: string}>};
    if (data.errors && data.errors.length > 0) {
      throwError(ERROR_CODES.GRAPH_NEO4J_UNAVAILABLE,
          `Neo4j DROP DATABASE errors: ${JSON.stringify(data.errors)}`);
    }
    // DROP DATABASE doesn't return a row count; return 1 for success.
    return 1;
  } catch (err) {
    // Neo4j unreachable — propagate; the consumer will mark this
    // tenant as failed, and the next cron run will retry.
    throwError(
        ERROR_CODES.GRAPH_NEO4J_UNAVAILABLE,
        `Neo4j cleanup (DROP DATABASE) failed: ${err instanceof Error ? err.message : String(err)}`,
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

/** Recursively delete all B2 objects whose key starts with `prefix`. */
async function purgeB2Prefix(client: B2Client, prefix: string): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined;
  do {
    const list = await client.list({prefix, cursor});
    for (const obj of list.objects) {
      await client.delete(obj.key);
      deleted++;
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return deleted;
}

/**
 * Permanently delete the user account from D1.
 * Called when a user's retention period has expired and the admin (or
 * cron) has triggered a hard cleanup with account deletion.
 *
 * PRECONDITION: user metadata has already been archived to B2.
 */
async function deleteTenantAccount(tenantId: string, env: CleanupEnv): Promise<boolean> {
  const orm = drizzle(env.DB);
  const result = await orm.delete(users)
      .where(eq(users.tenant_id, tenantId))
      .run();
  return (result.meta.changes ?? 0) > 0;
}

/** Mark the tenant's user row as cleared (soft mode — account stays). */
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
