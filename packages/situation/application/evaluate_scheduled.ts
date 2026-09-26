/**
 * @fileoverview Hourly job: schedule automations, KPI refresh and TTL
 * cleanup.
 */

import {DAY_MS, matchFilter, systemCtx} from '@ontodecide/shared-kernel';
import {AutomationIndex} from '../domain';
import type {SituationDeps} from './deps';
import {raiseAlert, refreshKpis} from './support';

/** Retention of metric points. */
export const METRIC_TTL_MS = 90 * DAY_MS;
/** Retention of processed event ids. */
export const PROCESSED_EVENT_TTL_MS = 7 * DAY_MS;
/** Retention of closed alerts. */
export const CLOSED_ALERT_TTL_MS = 365 * DAY_MS;
/** Objects evaluated per schedule rule (pages of 200). */
export const SCHEDULE_MAX_OBJECTS = 1000;

/** Runs the hourly evaluation for every tenant. */
export class EvaluateScheduled {
  constructor(private readonly deps: SituationDeps) {}

  async execute(nowIso: string): Promise<{fired: number}> {
    const {repos, logger} = this.deps;
    const parsed = new Date(nowIso);
    const now = Number.isNaN(parsed.getTime()) ? this.deps.clock.now() : parsed;
    const tenants = new Set([
      ...(await repos.automations.tenants()),
      ...(await repos.kpis.tenants()),
    ]);
    let fired = 0;
    for (const tenantId of tenants) {
      try {
        fired += await this.evaluateTenant(tenantId, now);
      } catch (e) {
        logger.error('scheduled evaluation failed', {
          tenantId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    const t = now.getTime();
    await repos.metrics.deleteOlderThan(t - METRIC_TTL_MS);
    await repos.processedEvents.deleteOlderThan(t - PROCESSED_EVENT_TTL_MS);
    await repos.alerts.deleteClosedBefore(t - CLOSED_ALERT_TTL_MS);
    return {fired};
  }

  private async evaluateTenant(tenantId: string, now: Date): Promise<number> {
    const {repos} = this.deps;
    const correlationId = `cron:${now.toISOString()}`;
    const ctx = systemCtx(tenantId, correlationId);
    const index = new AutomationIndex(await repos.automations.list(tenantId));
    let fired = 0;
    for (const auto of index.schedules()) {
      if (auto.trigger.kind !== 'schedule') continue;
      let cursor: string | undefined;
      let seen = 0;
      do {
        const page = await this.deps.objects.evaluateObjectSet(
          ctx,
          auto.trigger.objectSet,
          {limit: 200, ...(cursor ? {cursor} : {})},
        );
        for (const o of page.items) {
          seen++;
          if (!matchFilter(auto.condition, o.props)) continue;
          const r = await raiseAlert(
            this.deps,
            tenantId,
            auto,
            {rid: o.rid, title: o.title, snapshot: o.props},
            {now, correlationId},
          );
          if (r.created) fired++;
        }
        cursor = page.nextCursor ?? undefined;
      } while (cursor && seen < SCHEDULE_MAX_OBJECTS);
    }
    const kpis = await repos.kpis.list(tenantId);
    if (kpis.length > 0) await refreshKpis(this.deps, ctx, kpis);
    return fired;
  }
}
