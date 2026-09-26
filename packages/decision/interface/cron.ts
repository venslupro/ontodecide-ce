/**
 * @fileoverview Cron dispatcher (daily `0 1 * * *`).
 */

import type {Logger} from '@ontodecide/shared-kernel';
import type {DecisionHandlers} from './handlers';

/** The daily evaluation schedule. */
export const DAILY_CRON = '0 1 * * *';

/** Builds the scheduled handler. */
export function createDecisionCronHandler(
  h: Pick<DecisionHandlers, 'evaluateOutcomes'>,
  logger: Logger,
): (cron: string, now: Date) => Promise<void> {
  return async (cron, now) => {
    // decision-engine has a single schedule; run it even if the expression
    // was changed in wrangler.jsonc, but make the mismatch visible.
    if (cron !== DAILY_CRON) logger.warn('decision.unexpected_cron', {cron});
    const res = await h.evaluateOutcomes.execute(now.toISOString());
    logger.info('decision.outcomes_evaluated', res);
  };
}
