/**
 * @fileoverview Cron entry: every 15 minutes pulls REST sources and purges
 * expired data.
 */

import {PullRestSources, RunCleanup} from '../application';
import type {AppDeps} from '../application';

/** The data-integration cron expression. */
export const INTEGRATION_CRON = '*/15 * * * *';

/** Builds the scheduled handler. */
export function createCronDispatcher(
  deps: AppDeps,
): (cron: string, now: Date) => Promise<void> {
  const pull = new PullRestSources(deps);
  const cleanup = new RunCleanup(deps);
  return async cron => {
    if (cron !== INTEGRATION_CRON) {
      deps.logger.warn('unknown cron; running the default tasks', {cron});
    }
    try {
      await pull.execute();
    } catch (e) {
      deps.logger.error('rest pull run failed', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    try {
      await cleanup.execute();
    } catch (e) {
      deps.logger.error('cleanup run failed', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };
}
