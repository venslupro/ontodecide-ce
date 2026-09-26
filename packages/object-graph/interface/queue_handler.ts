/**
 * @fileoverview Queue dispatch by base queue name: `object-writes`
 * (UpsertObjects) and `graph-sync` (SyncGraph). Transient failures retry
 * the message with exponential backoff; malformed messages are acked.
 */

import type {ObjectWriteMsg} from '@ontodecide/integration/contract';
import {
  AppError,
  backoffSeconds,
  baseQueueName,
  QUEUES,
} from '@ontodecide/shared-kernel';
import type {QueueBatch, QueueMessage} from '@ontodecide/shared-kernel';
import type {GraphSyncMsg} from '../contract';
import {SyncGraph, UpsertObjects} from '../application';
import type {AppDeps} from '../application';

function isWriteMsg(body: unknown): body is ObjectWriteMsg {
  const m = body as Partial<ObjectWriteMsg> | null;
  return Boolean(
    m &&
    typeof m === 'object' &&
    typeof m.ctx?.tenantId === 'string' &&
    typeof m.jobId === 'string' &&
    typeof m.seq === 'number' &&
    Array.isArray(m.cmds),
  );
}

function isSyncMsg(body: unknown): body is GraphSyncMsg {
  const m = body as Partial<GraphSyncMsg> | null;
  return Boolean(
    m &&
    typeof m.tenantId === 'string' &&
    Array.isArray(m.upserts) &&
    Array.isArray(m.links),
  );
}

/** Builds the queue consumer. */
export function createQueueHandler(
  deps: AppDeps,
): (batch: QueueBatch<unknown>) => Promise<void> {
  const upsert = new UpsertObjects(deps);
  const sync = new SyncGraph(deps);
  const log = deps.logger;

  const run = async (
    queue: string,
    msg: QueueMessage<unknown>,
    fn: () => Promise<unknown>,
  ): Promise<void> => {
    try {
      await fn();
      msg.ack();
    } catch (e) {
      const err = AppError.from(e);
      log.warn('queue message failed; retrying', {
        queue,
        attempts: msg.attempts,
        code: err.code,
        detail: err.detail,
      });
      msg.retry({delaySeconds: backoffSeconds(msg.attempts)});
    }
  };

  return async batch => {
    const {name, dlq} = baseQueueName(batch.queue);
    if (dlq || (name !== QUEUES.objectWrites && name !== QUEUES.graphSync)) {
      log.warn('unexpected queue; acking', {queue: batch.queue});
      batch.ackAll();
      return;
    }
    for (const msg of batch.messages) {
      if (name === QUEUES.objectWrites) {
        if (!isWriteMsg(msg.body)) {
          log.error('malformed object-writes message; dropped', {id: msg.id});
          msg.ack();
          continue;
        }
        const body = msg.body;
        await run(name, msg, () => upsert.handle(body));
      } else {
        if (!isSyncMsg(msg.body)) {
          log.error('malformed graph-sync message; dropped', {id: msg.id});
          msg.ack();
          continue;
        }
        const body = msg.body;
        await run(name, msg, () => sync.handle(body));
      }
    }
  };
}
