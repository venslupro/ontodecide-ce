/**
 * Cron trigger: scheduled handler invoked at 03:00 UTC daily (see
 * `wrangler.toml` `[triggers]`).
 *
 * Steps (per design doc §4.6.1):
 *   1. List tenants due for cleanup (retention exceeded).
 *   2. Create a single task record tracking the whole batch.
 *   3. Enqueue one {@link CleanupMessage} per tenant (batch size 5 per
 *      message to stay under the Worker 10ms CPU limit).
 */
import { nowIso, uuid } from '@ontodecide/shared';
import type { CleanupEnv, CleanupTaskRecord } from '../types/env.js';
import { D1TenantCleanupRepository } from '../repository/tenant.repository.js';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { systemConfig } from '@ontodecide/shared/db';

const TASK_KEY_PREFIX = 'cleanup:task:';

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

/** Build and enqueue the daily cleanup task. */
export async function runDailyCleanup(env: CleanupEnv): Promise<void> {
  if (!(await isCleanupEnabled(env))) {
    return;
  }
  const repo = new D1TenantCleanupRepository(env.DB);
  const due = await repo.listDueForCleanup();
  if (due.length === 0) {
    return;
  }
  const taskId = uuid();
  const progress = due.map((row) => ({
    tenantId: row.tenant_id,
    state: 'pending' as const,
  }));
  const record: CleanupTaskRecord = {
    taskId,
    status: 'queued',
    // Retention-expired users get HARD mode + account deletion.
    // Their metadata is archived to the B2 tenant-archive bucket
    // BEFORE the account is deleted (compliance backup).
    mode: 'hard',
    triggeredBy: 'cron',
    tenantIds: due.map((row) => row.tenant_id),
    progress,
    progressPercent: 0,
    startedAt: nowIso(),
  };
  await writeTask(env, record);

  // Enqueue one message per tenant; the consumer processes them in
  // batches of `max_batch_size` (set in wrangler.toml).
  for (const tenant of due) {
    await env.CLEANUP_QUEUE.send({
      taskId,
      tenantId: tenant.tenant_id,
      mode: 'hard',
      triggeredBy: 'cron',
      // User retention expired → delete account + archive metadata.
      deleteAccount: true,
    });
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
