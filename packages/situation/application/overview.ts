/**
 * @fileoverview Cockpit overview: KPIs (with the value 24 h ago), trends,
 * open / acknowledged alerts (most severe first, ≤ 50) and the objects most
 * impacted by the latest recommendation.
 */

import {AppError, type CallCtx} from '@ontodecide/shared-kernel';
import type {KpiTrend, SituationOverview} from '../contract/types';
import {rangeMs} from '../domain';
import {ensureInitialized} from './install_pack_content';
import {type RoomRuntime, toAlertDto} from './support';

/** Alerts listed in the overview. */
export const OVERVIEW_ALERTS = 50;

/** Impacted objects listed in the overview. */
export const OVERVIEW_IMPACTED = 20;

/** Builds the overview from local state (no initialization). */
export function buildOverview(
  rt: RoomRuntime,
  range: '24h' | '7d',
): SituationOverview {
  const store = rt.deps.store;
  const now = rt.now();
  const kpis = store.listKpis();
  const byMetric = new Map<string, KpiTrend>(
    kpis.map(k => [k.id, {kpiId: k.id, points: []}]),
  );
  for (const p of store.listPoints(now - rangeMs(range))) {
    byMetric.get(p.metric)?.points.push({
      ts: new Date(p.ts).toISOString(),
      value: p.value,
    });
  }
  return {
    kpis: kpis.map(k => rt.kpiValue(k)),
    trends: [...byMetric.values()],
    alerts: store.activeAlerts(OVERVIEW_ALERTS).map(toAlertDto),
    impacted: (rt.recommendation()?.impacted ?? []).slice(0, OVERVIEW_IMPACTED),
    initialized: rt.initialized(),
    generatedAt: new Date(now).toISOString(),
  };
}

/**
 * Overview; the first call initializes the room. When the template cannot
 * be read yet the overview is returned with `initialized: false`.
 */
export async function overview(
  rt: RoomRuntime,
  ctx: CallCtx,
  q: {range: '24h' | '7d'},
): Promise<SituationOverview> {
  const reactivated = rt.touch(ctx);
  try {
    await ensureInitialized(rt);
  } catch (e) {
    rt.deps.logger.warn('situation.init_failed', {code: AppError.from(e).code});
  }
  if (reactivated) await rt.reschedule();
  return buildOverview(rt, q?.range === '7d' ? '7d' : '24h');
}
