/**
 * Cron trigger: scheduled handler invoked at 03:00 UTC daily (see
 * `wrangler.toml` `[triggers]`).
 *
 * Steps (per design doc §4.6.1 + inactivity extension):
 *   1. Read `cleanup_enabled` + `inactive_days_threshold` from system_config.
 *   2. List tenants due for cleanup (retention exceeded OR N days inactive).
 *   3. Split into HARD (expired / both) and SOFT (inactive) groups.
 *   4. Create one task record per mode-group tracking the batch.
 *   5. Enqueue one {@link CleanupMessage} per tenant with the correct
 *      mode, deleteAccount flag, and reason (for audit logging).
 */
import { nowIso, uuid } from '@ontodecide/shared';
import type { CleanupEnv, CleanupReason, CleanupTaskRecord, TenantDueRow } from '../types/env.js';
import { D1TenantCleanupRepository } from '../repository/tenant.repository.js';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { systemConfig } from '@ontodecide/shared/db';

const TASK_KEY_PREFIX = 'cleanup:task:';
const DEFAULT_INACTIVE_DAYS = 30;

/** Whether automatic cleanup is enabled (system_config flag). */
async function isCleanupEnabled(env: CleanupEnv): Promise<boolean> {
  const orm = drizzle(env.DB);
  const row = await orm
    .select({ value: systemConfig.value })
    .from(systemConfig)
    .where(eq(systemConfig.key, 'cleanup_enabled'))
    .get();
  return (row?.value ?? 'true').toLowerCase() === 'true';
}

/** Inactivity threshold in days. Defaults to 30 if unset or invalid. */
async function getInactiveDaysThreshold(env: CleanupEnv): Promise<number> {
  const orm = drizzle(env.DB);
  const row = await orm
    .select({ value: systemConfig.value })
    .from(systemConfig)
    .where(eq(systemConfig.key, 'inactive_days_threshold'))
    .get();
  const parsed = Number.parseInt(row?.value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_INACTIVE_DAYS;
  return parsed;
}

/** Resolve per-tenant mode + deleteAccount + reason flags from due_reason. */
function resolveCleanupFlags(
  row: TenantDueRow,
): { mode: 'soft' | 'hard'; deleteAccount: boolean; reason: CleanupReason } {
  switch (row.due_reason) {
    case 'inactive':
      // Account is still valid — just free up working space. Keep the
      // archive snapshot (soft) and retain the user row.
      return { mode: 'soft', deleteAccount: false, reason: 'inactive' };
    case 'expired':
    case 'both':
    default:
      // Retention expired or both conditions hit → hard cleanup with
      // account deletion. Metadata is archived to B2 for compliance
      // before the account row is removed.
      return { mode: 'hard', deleteAccount: true, reason: row.due_reason };
  }
}

/** Build and enqueue the daily cleanup task(s). */
export async function runDailyCleanup(env: CleanupEnv): Promise<void> {
  if (!(await isCleanupEnabled(env))) {
    return;
  }
  const repo = new D1TenantCleanupRepository(env.DB);
  const inactiveDays = await getInactiveDaysThreshold(env);
  const due = await repo.listDueForCleanup(inactiveDays);
  if (due.length === 0) {
    return;
  }

  // Group by resolved mode so each CleanupTaskRecord has a single mode
  // (CleanupTaskRecord.mode is a single value, not an array).
  const byMode = new Map<'soft' | 'hard', Array<TenantDueRow & { reason: CleanupReason; deleteAccount: boolean }>>();
  for (const row of due) {
    const flags = resolveCleanupFlags(row);
    const list = byMode.get(flags.mode) ?? [];
    list.push({ ...row, reason: flags.reason, deleteAccount: flags.deleteAccount });
    byMode.set(flags.mode, list);
  }

  // Enqueue one task per mode-group.
  for (const [mode, rows] of byMode) {
    const taskId = uuid();
    const progress = rows.map((row) => ({
      tenantId: row.tenant_id,
      state: 'pending' as const,
    }));
    const record: CleanupTaskRecord = {
      taskId,
      status: 'queued',
      mode,
      triggeredBy: 'cron',
      tenantIds: rows.map((row) => row.tenant_id),
      progress,
      progressPercent: 0,
      startedAt: nowIso(),
    };
    await writeTask(env, record);

    // One message per tenant; the consumer processes them in batches of
    // `max_batch_size` (set in wrangler.toml).
    for (const row of rows) {
      await env.CLEANUP_QUEUE.send({
        taskId,
        tenantId: row.tenant_id,
        mode: row.deleteAccount ? 'hard' : mode,
        triggeredBy: 'cron',
        reason: row.reason,
        deleteAccount: row.deleteAccount,
      });
    }
  }
}

/** Manual trigger for a single tenant or the whole due set. */
export async function triggerManualCleanup(
  env: CleanupEnv,
  tenantId: string | undefined,
  mode: 'soft' | 'hard',
  deleteAccount: boolean,
): Promise<string> {
  const taskId = uuid();
  const repo = new D1TenantCleanupRepository(env.DB);
  const tenants = tenantId
    ? [await repo.findByTenantId(tenantId)].filter((t): t is NonNullable<typeof t> => t !== null)
    : await repo.listDueForCleanup();
  if (tenants.length === 0) {
    return taskId; // nothing to do
  }
  const record: CleanupTaskRecord = {
    taskId,
    status: 'queued',
    mode,
    triggeredBy: 'admin',
    tenantIds: tenants.map((t) => t.tenant_id),
    progress: tenants.map((t) => ({ tenantId: t.tenant_id, state: 'pending' as const })),
    progressPercent: 0,
    startedAt: nowIso(),
  };
  await writeTask(env, record);
  for (const tenant of tenants) {
    await env.CLEANUP_QUEUE.send({
      taskId,
      tenantId: tenant.tenant_id,
      mode,
      triggeredBy: 'admin',
      reason: 'manual',
      deleteAccount: mode === 'hard' && deleteAccount,
    });
  }
  return taskId;
}

/** Persist a task record to KV. */
export async function writeTask(env: CleanupEnv, record: CleanupTaskRecord): Promise<void> {
  await env.CLEANUP_JOBS.put(TASK_KEY_PREFIX + record.taskId, JSON.stringify(record), {
    expirationTtl: 7 * 24 * 60 * 60,
  });
}

/** Read a task record from KV. */
export async function readTask(env: CleanupEnv, taskId: string): Promise<CleanupTaskRecord | null> {
  return env.CLEANUP_JOBS.get<CleanupTaskRecord>(TASK_KEY_PREFIX + taskId, 'json');
}

/** Update a single tenant's progress within a task. */
export async function updateTaskProgress(
  env: CleanupEnv,
  taskId: string,
  tenantId: string,
  state: 'succeeded' | 'failed',
  error?: string,
): Promise<CleanupTaskRecord | null> {
  const record = await readTask(env, taskId);
  if (!record) return null;
  const progress = record.progress.map((entry) =>
    entry.tenantId === tenantId ? { ...entry, state, error } : entry,
  );
  const succeeded = progress.filter((p) => p.state === 'succeeded').length;
  const failed = progress.filter((p) => p.state === 'failed').length;
  const done = succeeded + failed;
  const updated: CleanupTaskRecord = {
    ...record,
    progress,
    progressPercent: Math.round((done / Math.max(progress.length, 1)) * 100),
    status: done === progress.length ? (failed > 0 ? 'failed' : 'succeeded') : 'running',
    finishedAt: done === progress.length ? nowIso() : record.finishedAt,
  };
  await writeTask(env, updated);
  return updated;
}
