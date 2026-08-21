/**
 * Global configuration constants.
 *
 * Values mirror the design doc so that the defaults used in code are
 * traceable to a single source of truth.
 */
export const CONFIG = {
  /** JWT access-token lifetime in seconds (7 days). */
  ACCESS_TOKEN_TTL_SECONDS: 7 * 24 * 60 * 60,
  /** Refresh-token lifetime in seconds (30 days). */
  REFRESH_TOKEN_TTL_SECONDS: 30 * 24 * 60 * 60,

  /** Default daily Neuron budget for the Workers AI free tier. */
  NEURON_DAILY_LIMIT: 10_000,

  /** Soft threshold after which the budget manager starts rejecting. */
  NEURON_DAILY_SOFT_LIMIT: 9_500,

  /** Sync ingestion threshold; payloads with <= this many entities go inline. */
  INGEST_SYNC_THRESHOLD: 10,

  /** Cleanup batch size when publishing to the cleanup queue. */
  CLEANUP_BATCH_SIZE: 5,

  /** R2 archive retention days for the "regret window". */
  CLEANUP_ARCHIVE_RETENTION_DAYS: 3,

  /** Default data retention in days for a tenant. */
  DEFAULT_DATA_RETENTION_DAYS: 30,

  /** Maximum number of tenants on the free plan. */
  MAX_TENANTS: 10,

  /** Maximum number of users on the free plan. */
  MAX_USERS: 5,

  /** Cron schedule for the daily cleanup (03:00 UTC). */
  CLEANUP_CRON: '0 3 * * *',

  /** Cron schedule for the Neo4j keep-alive ping (every 6 hours). */
  KEEPALIVE_CRON: '0 */6 * * *',
} as const;

/** Cache key builders used across services. */
export const CACHE_KEYS = {
  situation: (tenantId: string, hash: string) => `situation:${tenantId}:${hash}`,
  scenario: (tenantId: string, hash: string) => `scenario:${tenantId}:${hash}`,
  ontology: (tenantId: string) => `ontology:${tenantId}`,
  jwtBlacklist: (jti: string) => `blacklist:${jti}`,
  neuronDaily: (dateKey: string) => `neuron:${dateKey}`,
  entity: (tenantId: string, id: string) => `entity:${tenantId}:${id}`,
  cleanupTask: (taskId: string) => `cleanup:task:${taskId}`,
};

/** Cache TTLs in seconds. */
export const CACHE_TTL = {
  SITUATION_HOT: 5 * 60,
  SCENARIO: 60 * 60,
  ONTOLOGY: 60 * 60,
  JWT_BLACKLIST: 7 * 24 * 60 * 60,
  NEURON_DAILY: 26 * 60 * 60,
  ENTITY_HOT: 10 * 60,
} as const;
