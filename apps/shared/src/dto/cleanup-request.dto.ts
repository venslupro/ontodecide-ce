/**
 * DTOs for the Cleanup service.
 */

/** Request body for `POST /api/admin/cleanup`. */
export interface CleanupRequestDto {
  /** Limit cleanup to a single tenant. If omitted, all due tenants run. */
  tenantId?: string;
  /** Soft keeps audit + backups, hard purges everything including archives. */
  mode?: 'soft' | 'hard';
}

/** Status response for `GET /api/admin/cleanup/status/:taskId`. */
export interface CleanupStatusDto {
  taskId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  /** 0..100 percent. */
  progress: number;
  /** Tenants processed so far. */
  processed: number;
  /** Total tenants to process. */
  total: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

/** Message body published to the cleanup queue. */
export interface CleanupMessage {
  taskId: string;
  tenantId: string;
  mode: 'soft' | 'hard';
  triggeredBy: 'cron' | 'admin';
}
