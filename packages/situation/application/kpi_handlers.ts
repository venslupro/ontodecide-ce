/**
 * @fileoverview KPI use cases: list, save, delete, trend and refresh.
 */

import {AppError, type CallCtx, ulid} from '@ontodecide/shared-kernel';
import type {KpiDef, KpiValue, MetricPoint} from '../contract';
import {kpiMetric, trend, trendRangeMs} from '../domain';
import type {SituationDeps} from './deps';
import type {KpiRecord} from './ports';
import {kpiValues, publish, refreshKpis, requireRole} from './support';
import {validateKpi} from './validation';

/** Lists KPIs with current values (Viewer). */
export class ListKpis {
  constructor(private readonly deps: SituationDeps) {}

  async execute(ctx: CallCtx): Promise<KpiValue[]> {
    requireRole(ctx, 'Viewer');
    const kpis = await this.deps.repos.kpis.list(ctx.tenantId);
    return kpiValues(this.deps, ctx.tenantId, kpis);
  }
}

/** Creates or updates a KPI and computes its value (Modeler). */
export class SaveKpi {
  constructor(private readonly deps: SituationDeps) {}

  async execute(ctx: CallCtx, input: KpiDef): Promise<KpiValue> {
    requireRole(ctx, 'Modeler');
    const def = validateKpi(input);
    const {kpis} = this.deps.repos;
    const existing = def.id ? await kpis.get(ctx.tenantId, def.id) : null;
    if (def.id && !existing) throw new AppError('NOT_FOUND', 'KPI not found');
    const record: KpiRecord = {
      ...def,
      id: existing?.id ?? ulid(this.deps.clock.now().getTime()),
      value: existing?.value ?? null,
      updatedAt: existing?.updatedAt ?? null,
      createdAt: existing?.createdAt ?? this.deps.clock.now().getTime(),
    };
    await kpis.save(ctx.tenantId, record);
    const [value] = await refreshKpis(this.deps, ctx, [record]);
    return value;
  }
}

/** Deletes a KPI and its metric points (Modeler). */
export class DeleteKpi {
  constructor(private readonly deps: SituationDeps) {}

  async execute(ctx: CallCtx, id: string): Promise<void> {
    requireRole(ctx, 'Modeler');
    const deleted = await this.deps.repos.kpis.delete(ctx.tenantId, id);
    if (!deleted) throw new AppError('NOT_FOUND', 'KPI not found');
    await this.deps.repos.metrics.deleteMetric(ctx.tenantId, kpiMetric(id));
    await publish(this.deps, ctx.tenantId, 'kpi', {id, deleted: true});
  }
}

/** KPI trend over 24 h (5-minute points) or 7 d (hourly) (Viewer). */
export class GetKpiTrend {
  constructor(private readonly deps: SituationDeps) {}

  async execute(
    ctx: CallCtx,
    id: string,
    range: '24h' | '7d',
  ): Promise<MetricPoint[]> {
    requireRole(ctx, 'Viewer');
    if (range !== '24h' && range !== '7d') {
      throw new AppError('VALIDATION_FAILED', 'range must be 24h or 7d');
    }
    const kpi = await this.deps.repos.kpis.get(ctx.tenantId, id);
    if (!kpi) throw new AppError('NOT_FOUND', 'KPI not found');
    const now = this.deps.clock.now().getTime();
    const metric = kpiMetric(id);
    const points = await this.deps.repos.metrics.range(
      ctx.tenantId,
      [metric],
      now - trendRangeMs(range),
      now,
    );
    return trend(points.get(metric) ?? [], range, now);
  }
}

/** Recomputes every KPI of the tenant (Modeler). */
export class RefreshKpis {
  constructor(private readonly deps: SituationDeps) {}

  async execute(ctx: CallCtx): Promise<KpiValue[]> {
    requireRole(ctx, 'Modeler');
    const kpis = await this.deps.repos.kpis.list(ctx.tenantId);
    return refreshKpis(this.deps, ctx, kpis);
  }
}
