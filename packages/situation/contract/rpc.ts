/**
 * @fileoverview RPC contract exposed by situation-awareness (SituationRpc).
 * WebSocket traffic uses `fetch` (forwarded by api-gateway with the ctx in
 * the `x-od-ctx` header) and is not part of this interface.
 */

import type {
  CallCtx,
  UsageResource,
  UsageStatus,
} from '@ontodecide/shared-kernel';
import type {
  AlertDto,
  AlertFilter,
  AutomationDef,
  AutomationDto,
  CockpitLayout,
  DeadLetterDto,
  KpiDef,
  KpiValue,
  MetricPoint,
  RecommendationSummary,
  SituationOverview,
} from './types';

/** Situation awareness RPC surface. */
export interface SituationRpc {
  overview(ctx: CallCtx): Promise<SituationOverview>;
  listKpis(ctx: CallCtx): Promise<KpiValue[]>;
  saveKpi(ctx: CallCtx, def: KpiDef): Promise<KpiValue>;
  deleteKpi(ctx: CallCtx, id: string): Promise<void>;
  kpiTrend(
    ctx: CallCtx,
    id: string,
    range: '24h' | '7d',
  ): Promise<MetricPoint[]>;
  /** Recomputes every KPI of the tenant (also runs hourly). */
  refreshKpis(ctx: CallCtx): Promise<KpiValue[]>;
  listAutomations(ctx: CallCtx): Promise<AutomationDto[]>;
  saveAutomation(ctx: CallCtx, def: AutomationDef): Promise<AutomationDto>;
  deleteAutomation(ctx: CallCtx, id: string): Promise<void>;
  /** Evaluates a draft rule against current objects; nothing is persisted. */
  dryRunAutomation(
    ctx: CallCtx,
    def: AutomationDef,
  ): Promise<{wouldFire: number; sample: string[]}>;
  listAlerts(ctx: CallCtx, filter?: AlertFilter): Promise<AlertDto[]>;
  updateAlert(
    ctx: CallCtx,
    id: string,
    patch: {status: 'ACKED' | 'CLOSED'},
  ): Promise<AlertDto>;
  /** Installs pack templates (automations and KPIs). */
  installPackContent(
    ctx: CallCtx,
    content: {automations?: unknown[]; kpis?: unknown[]},
  ): Promise<{automations: number; kpis: number}>;
  getLayout(ctx: CallCtx): Promise<CockpitLayout>;
  saveLayout(ctx: CallCtx, layout: CockpitLayout): Promise<CockpitLayout>;
  /** Called by decision-engine when a recommendation changes. */
  pushRecommendation(ctx: CallCtx, dto: RecommendationSummary): Promise<void>;
  /** Batched usage report from any service (UsageGuard). */
  recordUsage(
    batch: {resource: UsageResource; n: number}[],
  ): Promise<UsageStatus>;
  getUsage(ctx: CallCtx): Promise<UsageStatus>;
  /** Hourly scheduled automations. */
  evaluateScheduled(now: string): Promise<{fired: number}>;
  listDeadLetters(ctx: CallCtx, queue?: string): Promise<DeadLetterDto[]>;
  replayDeadLetters(
    ctx: CallCtx,
    queue: string,
    ids?: string[],
  ): Promise<{replayed: number}>;
}
