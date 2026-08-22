/**
 * Queue consumer for the Cleanup Service.
 *
 * Receives batches of {@link CleanupMessage}s (one tenant per message)
 * and invokes the per-tenant orchestrator. Failures are retried by the
 * platform up to `max_retries`; after that, the message is moved to the
 * dead-letter queue.
 */
import { nowIso } from '@ontodecide/shared';
import type { CleanupEnv, CleanupMessage } from '../types/env.js';
import { cleanupTenant } from '../service/cleanup.service.js';
import { readTask, updateTaskProgress, writeTask } from '../cron/trigger.js';

/** Cloudflare Workers `queue` handler. */
export async function handleCleanupBatch(
  batch: MessageBatch<CleanupMessage>,
  env: CleanupEnv,
): Promise<void> {
  await Promise.all(
    batch.messages.map(async (message) => {
      const body = message.body;
      try {
        // Ensure the task record exists (admin trigger path may have
        // already created it; cron path always does).
        if (!(await readTask(env, body.taskId))) {
          await writeTask(env, {
            taskId: body.taskId,
            status: 'running',
            mode: body.mode,
            triggeredBy: body.triggeredBy,
            tenantIds: [body.tenantId],
            progress: [{ tenantId: body.tenantId, state: 'running' }],
            progressPercent: 0,
            startedAt: nowIso(),
          });
        }
        await cleanupTenant(body.tenantId, body.mode, env, body.deleteAccount ?? false);
        await updateTaskProgress(env, body.taskId, body.tenantId, 'succeeded');
        message.ack();
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        await updateTaskProgress(env, body.taskId, body.tenantId, 'failed', reason);
        // Retry the message; the platform will dead-letter it after
        // max_retries attempts.
        message.retry();
      }
    }),
  );
}
