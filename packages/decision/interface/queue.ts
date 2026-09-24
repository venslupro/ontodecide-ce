/**
 * @fileoverview decision-jobs queue dispatcher.
 */

import {
  backoffSeconds,
  baseQueueName,
  QUEUES,
  type Logger,
  type QueueBatch,
} from '@ontodecide/shared-kernel';
import type {DecisionJobMsg} from '@ontodecide/situation/contract';
import type {DecisionHandlers} from './handlers';

/** max_retries of the decision-jobs consumer (wrangler.jsonc.tpl). */
export const DECISION_JOBS_MAX_RETRIES = 3;

/** Builds the queue handler. */
export function createDecisionQueueHandler(
  h: Pick<DecisionHandlers, 'processDecisionJob'>,
  logger: Logger,
): (batch: QueueBatch<unknown>) => Promise<void> {
  return async batch => {
    const {name, dlq} = baseQueueName(batch.queue);
    if (name !== QUEUES.decisionJobs || dlq) {
      logger.warn('decision.unknown_queue', {queue: batch.queue});
      batch.ackAll();
      return;
    }
    for (const m of batch.messages) {
      try {
        await h.processDecisionJob.execute(m.body as DecisionJobMsg, {
          finalAttempt: m.attempts > DECISION_JOBS_MAX_RETRIES,
        });
        m.ack();
      } catch (e) {
        logger.warn('decision.job_retry', {
          attempts: m.attempts,
          error: e instanceof Error ? e.message : String(e),
        });
        m.retry({delaySeconds: backoffSeconds(m.attempts)});
      }
    }
  };
}
