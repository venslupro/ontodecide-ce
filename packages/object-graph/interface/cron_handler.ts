/**
 * @fileoverview Cron dispatch (`*\/15 * * * *`): runs maintenance.
 */

import {RunMaintenance} from '../application';
import type {AppDeps, MaintenanceReport} from '../application';

/** Builds the scheduled handler. */
export function createCronHandler(
  deps: AppDeps,
): (cron: string, now: Date) => Promise<MaintenanceReport> {
  const maintenance = new RunMaintenance(deps);
  return async (cron, now) => {
    const report = await maintenance.handle(now);
    deps.logger.info('cron finished', {cron, ...report});
    return report;
  };
}
