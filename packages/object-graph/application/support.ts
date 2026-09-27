/**
 * @fileoverview Shared use-case helpers: outbox rows and post-commit
 * delivery (send, then delete the outbox row; failures are left to the
 * 15-minute cron redelivery).
 */

import {AppError, ulid} from '@ontodecide/shared-kernel';
import type {
  DomainEventKind,
  DomainEventMsg,
  ObjectChangeRef,
} from '@ontodecide/shared-kernel';
import type {GraphDeps, OutboxRow, TenantRepos} from './ports';

/** Builds the outbox row of one commit. */
export function outboxRow(
  tid: string,
  nowMs: number,
  kind: DomainEventKind,
  changes: ObjectChangeRef[],
  extra: Pick<
    DomainEventMsg,
    'jobId' | 'actionLogId' | 'recommendationId'
  > = {},
): OutboxRow {
  const id = ulid(nowMs);
  const msg: DomainEventMsg = {
    eventId: id,
    tid,
    occurredAt: nowMs,
    kind,
    ...Object.fromEntries(
      Object.entries(extra).filter(([, v]) => v !== undefined),
    ),
    changes,
  };
  return {id, msg};
}

/**
 * Publishes a committed outbox row and deletes it. Never throws: an
 * undelivered row stays for the cron.
 */
export async function deliver(
  deps: GraphDeps,
  repos: TenantRepos,
  row: OutboxRow,
): Promise<boolean> {
  try {
    await deps.publisher.publish(row.msg);
  } catch (e) {
    deps.logger.warn('outbox.publish_failed', {
      tid: row.msg.tid,
      eventId: row.id,
      error: AppError.from(e).code,
    });
    return false;
  }
  try {
    await repos.outbox.delete(row.id);
  } catch (e) {
    deps.logger.warn('outbox.delete_failed', {
      tid: row.msg.tid,
      eventId: row.id,
      error: AppError.from(e).code,
    });
  }
  return true;
}

/** Rejects writes for a workspace this service has already purged. */
export function ensureNotTombstoned(tombstoned: boolean): void {
  if (tombstoned) throw new AppError('NOT_FOUND', 'Workspace not found');
}
