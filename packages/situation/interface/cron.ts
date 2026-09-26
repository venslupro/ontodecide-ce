/**
 * @fileoverview Cron dispatch (`0 * * * *`).
 */

import {EvaluateScheduled, type SituationDeps} from '../application';

/** Builds the scheduled handler. */
export function createCronHandler(
  deps: SituationDeps,
): (cron: string, now: Date) => Promise<void> {
  const evaluate = new EvaluateScheduled(deps);
  return async (cron, now) => {
    const {fired} = await evaluate.execute(now.toISOString());
    deps.logger.info('scheduled evaluation done', {cron, fired});
  };
}
