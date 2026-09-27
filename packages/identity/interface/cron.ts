/**
 * @fileoverview identity-access cron (every 2 minutes) (详细设计 6.11.6):
 * ensureBootstrapAdmin → reminders → expire trials → one archive step →
 * one final delete → housekeeping (pending admin changes; hourly analytics
 * check and daily audit anchor). Each stage is isolated: a failure is
 * logged and the next stage still runs.
 */

import {AppError} from '@ontodecide/shared-kernel';
import {MaintenanceService} from '../application';
import type {IdentityServices} from './compose';

/** Summary of one run (for logs and tests). */
export interface CronReport {
  reminders: number;
  expired: number;
  archive: string;
  finalDeleted: number;
  hourly: boolean;
  errors: string[];
}

/** Runs one cron tick. */
export async function runCron(
  s: IdentityServices,
  now: Date,
): Promise<CronReport> {
  const report: CronReport = {
    reminders: 0,
    expired: 0,
    archive: 'idle',
    finalDeleted: 0,
    hourly: false,
    errors: [],
  };
  const stage = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      report.errors.push(name);
      s.logger.error('identity.cron_stage_failed', {
        stage: name,
        code: AppError.from(e).code,
      });
    }
  };
  await stage('bootstrap', () => s.bootstrap.ensure());
  await stage('reminders', async () => {
    report.reminders = await s.trials.sendReminders();
  });
  await stage('expire', async () => {
    report.expired = await s.trials.expireDue();
  });
  await stage('archive', async () => {
    report.archive = await s.saga.tick();
  });
  await stage('final_delete', async () => {
    report.finalDeleted = await s.trials.finalDeleteDue(1);
  });
  await stage('housekeeping', () => s.housekeeping.run());
  await stage('pending_changes', () => s.maintenance.pendingChanges());
  if (MaintenanceService.isHourlyTick(now)) {
    report.hourly = true;
    await stage('analytics', async () => {
      await s.maintenance.analyticsCheck();
    });
    await stage('audit_anchor', async () => {
      await s.maintenance.auditAnchor();
    });
  }
  return report;
}
