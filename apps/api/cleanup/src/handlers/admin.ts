/**
 * Admin HTTP handlers for the Cleanup Service.
 *
 *   POST /cleanup        body: { tenantId?, mode? }  → { taskId }
 *   GET  /cleanup/status/:id                          → CleanupStatusDto
 */
import type {Context} from 'hono';
import {
  ERROR_CODES,
  HEADERS,
  fail,
  ok,
} from '@ontodecide/shared';
import type {CleanupEnv} from '../types/env.js';
import {readTask, triggerManualCleanup} from '../cron/trigger.js';

/** POST /cleanup */
export async function triggerCleanupHandler(c: Context) {
  const env = c.env as CleanupEnv;
  const role = c.req.header(HEADERS.USER_ROLE);
  if (role !== 'admin') {
    return c.json(
        fail(ERROR_CODES.AUTH_FORBIDDEN, 'Admin role required.'),
        403,
    );
  }
  const body = (await c.req.json()) as {
    tenantId?: string;
    mode?: 'soft' | 'hard';
    deleteAccount?: boolean;
  };
  const taskId = await triggerManualCleanup(
      env,
      body.tenantId,
      body.mode ?? 'soft',
      body.deleteAccount ?? false,
  );
  return c.json(ok({taskId}, c.req.header(HEADERS.TRACE_ID)), 202);
}

/** GET /cleanup/status/:id */
export async function cleanupStatusHandler(c: Context) {
  const env = c.env as CleanupEnv;
  const taskId = c.req.param('id');
  if (!taskId) {
    return c.json(
        fail(ERROR_CODES.VALIDATION_FAILED, 'Task id is required.'),
        400,
    );
  }
  const record = await readTask(env, taskId);
  if (!record) {
    return c.json(
        fail(ERROR_CODES.CLEANUP_TASK_NOT_FOUND, `Task ${taskId} not found.`),
        404,
    );
  }
  return c.json(
      ok({
        taskId: record.taskId,
        status: record.status,
        progress: record.progressPercent,
        processed: record.progress.filter((p) => p.state === 'succeeded' || p.state === 'failed').length,
        total: record.progress.length,
        startedAt: record.startedAt,
        finishedAt: record.finishedAt,
        error: record.error,
      }, c.req.header(HEADERS.TRACE_ID)),
      200,
  );
}
