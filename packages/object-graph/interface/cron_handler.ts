/**
 * @fileoverview Cron dispatch of object-graph. The only trigger is
 * `*\/15 * * * *`: outbox redelivery and tombstone sweep.
 */

import type {Clock, Logger} from '@ontodecide/shared-kernel';
import {runMaintenance} from '../application';
import type {EventPublisher, OutboxRelayStore} from '../application';

/** The object-graph cron expression. */
export const OUTBOX_CRON = '*/15 * * * *';

/** Builds the scheduled() handler. */
export function createCronHandler(deps: {
  store: () => OutboxRelayStore;
  publisher: EventPublisher;
  clock: Clock;
  logger: Logger;
}): (cron: string, now: Date) => Promise<void> {
  return async (cron, now) => {
    if (cron !== OUTBOX_CRON) {
      deps.logger.warn('cron.unknown', {cron});
    }
    await runMaintenance({
      store: deps.store(),
      publisher: deps.publisher,
      clock: {now: () => now ?? deps.clock.now()},
      logger: deps.logger,
    });
  };
}
