/**
 * @fileoverview Helpers shared by handlers: role checks, best-effort
 * realtime pushes, KPI computation and alert raising.
 */

import {
  AppError,
  type CallCtx,
  DAY_MS,
  HOUR_MS,
  type Role,
  type Rid,
  hasRole,
  systemCtx,
  ulid,
} from '@ontodecide/shared-kernel';
import type {AutomationDto, KpiValue} from '../contract';
import {
  bucket5m,
  decideAlert,
  kpiMetric,
  previousValue,
  sparkline,
} from '../domain';
import type {SituationDeps} from './deps';
import type {KpiRecord, WsMsgType} from './ports';

/** Throws FORBIDDEN unless the caller holds at least `role`. */
export function requireRole(ctx: CallCtx, role: Role): void {
  if (!hasRole(ctx.roles, role)) {
    throw new AppError('FORBIDDEN', `Requires role ${role}`);
  }
}

/** Pushes a realtime message; failures are logged, never thrown. */
export async function publish(
  deps: SituationDeps,
  tenantId: string,
  type: Exclude<WsMsgType, 'snapshot'>,
  data: unknown,
): Promise<void> {
  try {
    await deps.rooms(tenantId).publish(type, data);
  } catch (e) {
    deps.logger.warn('situation room push failed', {
      tenantId,
      type,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Builds KPI values (previous and sparkline from metric points). */
export async function kpiValues(
  deps: SituationDeps,
  tenantId: string,
  kpis: readonly KpiRecord[],
): Promise<KpiValue[]> {
  if (kpis.length === 0) return [];
  const now = deps.clock.now().getTime();
  const points = await deps.repos.metrics.range(
    tenantId,
    kpis.map(k => kpiMetric(k.id)),
    now - DAY_MS - HOUR_MS,
    now,
  );
  return kpis.map(k => {
    const series = points.get(kpiMetric(k.id)) ?? [];
    return {
      id: k.id,
      name: k.name,
      value: k.value,
      previous: previousValue(series, now),
      target: k.target ?? null,
      unit: k.unit ?? null,
      higherIsBetter: k.higherIsBetter ?? true,
      spark: sparkline(series, now),
      updatedAt:
        k.updatedAt === null ? null : new Date(k.updatedAt).toISOString(),
    };
  });
}

/**
 * Recomputes KPIs via OBJECTS.aggregate, stores the value and a 5-minute
 * metric point, and pushes `kpi` messages. Returns the fresh values.
 */
export async function refreshKpis(
  deps: SituationDeps,
  ctx: CallCtx,
  kpis: readonly KpiRecord[],
): Promise<KpiValue[]> {
  const tenantId = ctx.tenantId;
  const now = deps.clock.now().getTime();
  const fresh: KpiRecord[] = [];
  for (const k of kpis) {
    let value: number | null = null;
    try {
      const v = await deps.objects.aggregate(ctx, {
        objectSet: k.objectSet,
        fn: k.aggregate.fn,
        ...(k.aggregate.prop ? {prop: k.aggregate.prop} : {}),
      });
      value = typeof v === 'number' && Number.isFinite(v) ? v : null;
    } catch (e) {
      deps.logger.warn('kpi aggregate failed', {
        tenantId,
        kpiId: k.id,
        error: e instanceof Error ? e.message : String(e),
      });
      fresh.push(k);
      continue;
    }
    await deps.repos.kpis.setValue(tenantId, k.id, value, now);
    if (value !== null) {
      await deps.repos.metrics.upsert(
        tenantId,
        kpiMetric(k.id),
        bucket5m(now),
        value,
      );
    }
    fresh.push({...k, value, updatedAt: now});
  }
  const values = await kpiValues(deps, tenantId, fresh);
  for (const v of values) await publish(deps, tenantId, 'kpi', v);
  return values;
}

/** Object hit by a rule. */
export interface AlertTarget {
  rid: Rid | null;
  title: string;
  snapshot: Record<string, unknown>;
}

/** Outcome of a rule hit. */
export interface RaiseResult {
  alertId: string;
  created: boolean;
}

/**
 * Records a rule hit following the de-duplication / cooldown policy. A new
 * alert fires the rule's effects: `alert` pushes to the SituationRoom,
 * `recommend` queues a decision job, `action` applies an action (errors are
 * logged, not thrown).
 */
export async function raiseAlert(
  deps: SituationDeps,
  tenantId: string,
  auto: AutomationDto,
  target: AlertTarget,
  opts: {now: Date; correlationId: string},
): Promise<RaiseResult> {
  const {alerts} = deps.repos;
  const nowMs = opts.now.getTime();
  const hasAlertEffect = auto.effects.some(e => e.kind === 'alert');
  const latest = await alerts.latestFor(tenantId, auto.id, target.rid);
  const decision = decideAlert(latest, nowMs, auto.cooldownSec);

  if (decision.kind === 'create') {
    const id = ulid(nowMs);
    const inserted = await alerts.insertOpen(tenantId, {
      id,
      automationId: auto.id,
      rid: target.rid,
      title: target.title,
      severity: auto.severity,
      snapshot: target.snapshot,
      raisedAt: nowMs,
    });
    if (inserted) {
      await deps.repos.automations.markFired(tenantId, auto.id, nowMs);
      await fireEffects(deps, tenantId, auto, id, target, opts.correlationId);
      return {alertId: id, created: true};
    }
    // Lost a race with a concurrent OPEN alert: treat as a hit.
    const current = await alerts.latestFor(tenantId, auto.id, target.rid);
    if (!current) throw new AppError('CONFLICT', 'Alert insert conflict');
    await alerts.hit(tenantId, current.id, target.snapshot);
    return {alertId: current.id, created: false};
  }

  await alerts.hit(tenantId, decision.alertId, target.snapshot);
  if (decision.reason === 'active' && hasAlertEffect) {
    const dto = await alerts.get(tenantId, decision.alertId);
    if (dto) await publish(deps, tenantId, 'alert', dto);
  }
  return {alertId: decision.alertId, created: false};
}

async function fireEffects(
  deps: SituationDeps,
  tenantId: string,
  auto: AutomationDto,
  alertId: string,
  target: AlertTarget,
  correlationId: string,
): Promise<void> {
  for (const effect of auto.effects) {
    try {
      if (effect.kind === 'alert') {
        const dto = await deps.repos.alerts.get(tenantId, alertId);
        if (dto) await publish(deps, tenantId, 'alert', dto);
      } else if (effect.kind === 'recommend') {
        if (!target.rid) {
          deps.logger.warn('recommend effect skipped: no focus object', {
            tenantId,
            automationId: auto.id,
          });
          continue;
        }
        await deps.decisionJobs.send({
          ctx: systemCtx(tenantId, correlationId),
          jobId: ulid(),
          alertId,
          focus: target.rid,
          ...(effect.perturbation ? {perturbation: effect.perturbation} : {}),
        });
      } else {
        if (!target.rid) continue;
        await deps.objects.applyAction(systemCtx(tenantId, correlationId), {
          actionType: effect.actionType,
          target: target.rid,
          params: effect.params ?? {},
        });
      }
    } catch (e) {
      deps.logger.error('automation effect failed', {
        tenantId,
        automationId: auto.id,
        alertId,
        effect: effect.kind,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
