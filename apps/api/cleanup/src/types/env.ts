/**
 * Environment bindings for the Cleanup Service.
 */
import type {BaseEnv} from '@ontodecide/shared';

export interface CleanupEnv extends BaseEnv {
  /** Queue producer used to enqueue per-tenant cleanup jobs. */
  CLEANUP_QUEUE: Queue<CleanupMessage>;
  /** D1 database (shared with User + AI services). */
  DB: D1Database;
  /** R2 bucket for archive copies. */
  BUCKET: R2Bucket;
  /** KV namespace for User Service caches (to purge). */
  USER_CACHE: KVNamespace;
  /** KV namespace for Graph Service caches (to purge). */
  GRAPH_CACHE: KVNamespace;
  /** KV namespace for Ingestion Service job records (to purge). */
  INGESTION_JOBS: KVNamespace;
  /** KV namespace for AI Service caches + neuron counter (to purge). */
  AI_CACHE: KVNamespace;
  /** KV namespace for Cleanup Service job records (read/write here). */
  CLEANUP_JOBS: KVNamespace;
  /** Neo4j AuraDB base URL. */
  NEO4J_URL: string;
  /** Neo4j username. */
  NEO4J_USER: string;
  /** Neo4j password (secret). */
  NEO4J_PASSWORD: string;
}

/** Message published to the cleanup queue. */
export interface CleanupMessage {
  taskId: string;
  tenantId: string;
  mode: 'soft' | 'hard';
  triggeredBy: 'cron' | 'admin';
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
  role: 'admin' | 'analyst' | 'viewer';
  is_active: 0 | 1;
  is_data_cleared: 0 | 1;
  last_cleanup_at: string | null;
  data_retention_days: number;
  data_size_estimate: number;
}
