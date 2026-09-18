/**
 * Environment bindings for the Cleanup Service.
 */
import type { BaseEnv } from '@ontodecide/shared';

export interface CleanupEnv extends BaseEnv {
  /** Queue producer used to enqueue per-tenant cleanup jobs. */
  CLEANUP_QUEUE: Queue<CleanupMessage>;
  /** D1 database (shared with User + AI services). */
  DB: D1Database;
  /** Backblaze B2 S3-compatible credentials + dual buckets. */
  B2_KEY_ID: string;
  B2_KEY: string;
  B2_REGION: string;
  /** Ingestion staging bucket — purged on user expiry. */
  B2_INGESTION_BUCKET: string;
  /** Tenant archive bucket — user metadata archived here before deletion. */
  B2_ARCHIVE_BUCKET: string;
  /** KV namespace for User Service caches (to purge). */
  USER_CACHE: KVNamespace;
  /** KV namespace for Ingestion Service job records (to purge). */
  INGESTION_JOBS: KVNamespace;
  /** KV namespace for AI Service caches + neuron counter (to purge). */
  AI_CACHE: KVNamespace;
  /** KV namespace for Cleanup Service job records (read/write here). */
  CLEANUP_JOBS: KVNamespace;
  /** Neo4j connection URI, e.g. `neo4j+s://c757868d.databases.neo4j.io`. */
  NEO4J_URI: string;
  /** Neo4j username (for Aura, this is the instance id). */
  NEO4J_USERNAME: string;
  /** Neo4j password (secret). */
  NEO4J_PASSWORD: string;
  /** Neo4j database name (single shared DB for all tenants). */
  NEO4J_DATABASE: string;
}

/**
 * Derive the HTTPS transactional-API base URL from a Neo4j connection URI.
 *
 * Cloudflare Workers cannot open raw TCP sockets (Bolt), so we translate
 * the Bolt URI into the equivalent HTTPS endpoint.
 */
export function neo4jHttpBaseUrl(uri: string): string {
  const parsed = new URL(uri);
  const proto = parsed.protocol.replace(/:$/, '');
  const httpProto = proto === 'neo4j+s' || proto === 'neo4j+ssc' || proto === 'https' ? 'https' : 'http';
  const port = parsed.port ? `:${parsed.port}` : '';
  return `${httpProto}://${parsed.hostname}${port}`;
}

/** Why a cleanup was scheduled — used in audit logging and task
 *  classification. `manual` means an admin triggered it directly. */
export type CleanupReason = 'expired' | 'inactive' | 'both' | 'manual';

/** Message published to the cleanup queue. */
export interface CleanupMessage {
  taskId: string;
  tenantId: string;
  mode: 'soft' | 'hard';
  triggeredBy: 'cron' | 'admin';
  /** Why this specific tenant is being cleaned up. */
  reason: CleanupReason;
  /**
   * When true (hard mode triggered by user-expiry / admin deletion),
   * the consumer also deletes the user account from D1 after archiving
   * their metadata to the tenant-archive B2 bucket.
   */
  deleteAccount?: boolean;
}

/** Job-status record stored in KV under `cleanup:task:<taskId>`. */
export interface CleanupTaskRecord {
  taskId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  mode: 'soft' | 'hard';
  triggeredBy: 'cron' | 'admin';
  /** Tenants scheduled for this task (multi-tenant cron runs). */
  tenantIds: string[];
  /** Per-tenant progress, filled in as the consumer completes each. */
  progress: Array<{
    tenantId: string;
    state: 'pending' | 'running' | 'succeeded' | 'failed';
    error?: string;
  }>;
  progressPercent: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

/** Tenant row shape used by the Cleanup Service. */
export interface TenantRow {
  id: string;
  tenant_id: string;
  role: 'admin' | 'user';
  is_active: 0 | 1;
  is_data_cleared: 0 | 1;
  last_cleanup_at: string | null;
  data_retention_days: number;
  data_size_estimate: number;
  expires_at: string | null;
}

/** Row from listDueForCleanup including the classification flag used by
 *  the cron trigger to choose soft (inactive) vs hard (expired) mode. */
export type TenantDueRow = TenantRow & {
  due_reason: 'expired' | 'inactive' | 'both';
};
