/**
 * @fileoverview Queue consumer entry: routes batches by base queue name and
 * applies ack / retry-with-backoff per message.
 */

import {backoffSeconds, baseQueueName, QUEUES} from '@ontodecide/shared-kernel';
import type {Logger, QueueBatch} from '@ontodecide/shared-kernel';
import {ProcessIngestMessage} from '../application';
import type {AppDeps} from '../application';
import type {IngestMsg} from '../contract';

function isIngestMsg(v: unknown): v is IngestMsg {
  const m = v as Partial<IngestMsg> | null;
  return (
    !!m &&
    typeof m === 'object' &&
    !!m.ctx &&
    typeof m.ctx.tenantId === 'string' &&
    typeof m.jobId === 'string' &&
    typeof m.sourceId === 'string' &&
    typeof m.seq === 'number' &&
    typeof m.rowOffset === 'number' &&
    Array.isArray(m.records)
  );
}

/** Builds the queue handler of data-integration. */
export function createQueueDispatcher(
  deps: AppDeps,
): (batch: QueueBatch<unknown>) => Promise<void> {
  const ingest = new ProcessIngestMessage(deps);
  const log: Logger = deps.logger;
  return async batch => {
    const {name} = baseQueueName(batch.queue);
    if (name !== QUEUES.ingest) {
      log.error('unexpected queue', {queue: batch.queue});
      batch.ackAll();
      return;
    }
    for (const msg of batch.messages) {
      if (!isIngestMsg(msg.body)) {
        log.error('malformed ingest message dropped', {id: msg.id});
        msg.ack();
        continue;
      }
      try {
        await ingest.execute(msg.body);
        msg.ack();
      } catch (e) {
        log.warn('ingest message failed; retrying', {
          tenantId: msg.body.ctx.tenantId,
          jobId: msg.body.jobId,
          seq: msg.body.seq,
          attempts: msg.attempts,
          error: e instanceof Error ? e.message : String(e),
        });
        msg.retry({delaySeconds: backoffSeconds(msg.attempts)});
      }
    }
  };
}
