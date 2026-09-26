/**
 * @fileoverview Queue dispatch: `situation-events` and every `*-dlq`.
 */

import type {SituationEventMsg} from '@ontodecide/object-graph/contract';
import {
  AppError,
  QUEUES,
  type QueueBatch,
  baseQueueName,
} from '@ontodecide/shared-kernel';
import {
  type AutomationIndexCache,
  ProcessSituationEvent,
  type SituationDeps,
  StoreDeadLetters,
} from '../application';

/** Builds the queue consumer. */
export function createQueueHandler(
  deps: SituationDeps,
): (batch: QueueBatch<unknown>) => Promise<void> {
  const processEvent = new ProcessSituationEvent(deps);
  const storeDeadLetters = new StoreDeadLetters(deps);
  return async batch => {
    const {name, dlq} = baseQueueName(batch.queue);
    if (dlq) {
      await storeDeadLetters.execute(batch.queue, batch.messages);
      batch.ackAll();
      return;
    }
    if (name !== QUEUES.situationEvents) {
      throw new AppError('INTERNAL', `Unexpected queue ${batch.queue}`);
    }
    const cache: AutomationIndexCache = new Map();
    for (const m of batch.messages) {
      const msg = m.body as SituationEventMsg;
      try {
        await processEvent.execute(msg, cache);
        m.ack();
      } catch (e) {
        deps.logger.error('situation event failed', {
          eventId: msg?.eventId,
          tenantId: msg?.tenantId,
          attempts: m.attempts,
          error: e instanceof Error ? e.message : String(e),
        });
        m.retry();
      }
    }
  };
}
