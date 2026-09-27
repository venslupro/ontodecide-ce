/**
 * @fileoverview Community Edition limits (详细设计 6.7 边界值). Services read
 * overridable values from their `vars`; these are the defaults and the
 * values the web app pre-checks against.
 */

/** Per-workspace and per-user limits. */
export const CE_LIMITS = {
  /** Objects per workspace. */
  objects: 300,
  /** Links per workspace. */
  links: 900,
  /** Imported rows per user per UTC day. */
  importRowsDaily: 2000,
  /** Rows per synchronous import batch. */
  batchRows: 100,
  /** AI recommendations per user per UTC day. */
  aiRecsDaily: 3,
  /** AI mapping drafts per user per UTC day. */
  mappingDraftsDaily: 2,
  /** Sessions per user (oldest evicted). */
  sessions: 3,
  /** Realtime connections per user (oldest closed). */
  streams: 3,
  /** Request body limit enforced by the gateway. */
  maxBodyBytes: 512 * 1024,
  /** Browser-side file size limit. */
  maxFileBytes: 5 * 1024 * 1024,
  /** Link query / propagation depth. */
  maxDepth: 2,
  /** Simulation subgraph nodes. */
  maxSimulationNodes: 300,
  /** Perturbations per scenario. */
  maxPerturbations: 10,
  /** Scheduled automations per workspace. */
  maxScheduledAutomations: 3,
  /** Minimum interval of a scheduled automation, hours. */
  minScheduleHours: 1,
  /** Alert cooldown bounds, seconds. */
  cooldownDefaultSec: 3600,
  cooldownMaxSec: 86_400,
  /** Recommendation lifetime, hours. */
  recExpireHours: 24,
  /** Idempotency-Key length bounds. */
  idempotencyKeyMin: 16,
  idempotencyKeyMax: 64,
  /** domain-events message size, bytes. */
  maxEventBytes: 64 * 1024,
} as const;

/** Trial and archive lifecycle timings (修订说明书 9.2). */
export const LIFECYCLE = {
  trialHours: 72,
  reminderAfterHours: 48,
  /** Wait after EXPIRED before archiving (access token TTL + 1 min). */
  archiveDelayMin: 16,
  archiveDays: 7,
  tombstoneHours: 48,
  accessTokenMin: 15,
  adminSessionHours: 8,
  streamTicketSec: 30,
  /** Maximum rows purged per service per archive step. */
  purgeBatchRows: 500,
  /** Export page bounds. */
  exportPageRows: 2000,
  exportPageBytes: 900 * 1024,
  /** Archive ZIP upper bound. */
  maxArchiveBytes: 2 * 1024 * 1024,
} as const;

/** Workers AI models (修订说明书 12.6). */
export const AI_MODELS = {
  primary: '@cf/qwen/qwen3-30b-a3b-fp8',
  fallback: '@cf/openai/gpt-oss-20b',
} as const;
