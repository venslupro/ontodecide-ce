/**
 * @fileoverview The room's single DO alarm (详细设计 6.11.4 定时自动化):
 * final deletion of a tombstone, metric flush and due scheduled rules.
 */

import {advanceRun} from '../domain';
import {flushMetrics} from './kpi_handlers';
import type {AlertRecord} from './ports';
import {META, type RoomRuntime} from './support';

/** Result of one alarm run (for tests and logs). */
export interface AlarmResult {
  kind: 'deleted' | 'tombstone' | 'inactive' | 'ran';
  rulesRun: number;
  pointsWritten: number;
}

/** Handles the alarm. */
export async function runAlarm(rt: RoomRuntime): Promise<AlarmResult> {
  const {store, storage, logger} = rt.deps;
  const now = rt.now();
  const until = store.tombstoneUntil();
  if (until !== null) {
    if (now >= until) {
      await storage.deleteAll();
      await storage.deleteAlarm();
      rt.reset();
      logger.info('situation.tombstone_deleted', {});
      return {kind: 'deleted', rulesRun: 0, pointsWritten: 0};
    }
    await storage.setAlarm(until);
    return {kind: 'tombstone', rulesRun: 0, pointsWritten: 0};
  }
  if (store.getMeta(META.inactive) !== null) {
    await rt.reschedule();
    return {kind: 'inactive', rulesRun: 0, pointsWritten: 0};
  }

  let pointsWritten = 0;
  const flush = store.getMeta(META.metricFlushAt);
  if (flush !== null && Number(flush) <= now) {
    pointsWritten = flushMetrics(rt, now);
  }

  const alerts: AlertRecord[] = [];
  let rulesRun = 0;
  for (const rule of store.listAutomations()) {
    if (
      rule.trigger !== 'schedule' ||
      !rule.enabled ||
      rule.nextRunAt === null ||
      rule.nextRunAt > now ||
      !rule.everyHours
    ) {
      continue;
    }
    rulesRun++;
    const seen = new Set<string>();
    for (const o of store.listObjects(rule.objectType)) {
      seen.add(o.rid);
      rt.evaluate(rule, o.rid, o, alerts);
    }
    for (const a of store.activeAlertsOf(rule.id)) {
      if (a.rid && !seen.has(a.rid)) rt.evaluate(rule, a.rid, null, alerts);
    }
    rule.nextRunAt = advanceRun(rule.nextRunAt, rule.everyHours, now);
    store.updateAutomation(rule);
  }
  if (rulesRun) rt.rulesChanged();
  rt.pushAlerts(alerts);
  await rt.reschedule();
  return {kind: 'ran', rulesRun, pointsWritten};
}
