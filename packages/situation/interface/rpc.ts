/**
 * @fileoverview RPC handler object implementing SituationRpc.
 */

import {
  DeleteAutomation,
  DeleteKpi,
  DryRunAutomation,
  EvaluateScheduled,
  GetKpiTrend,
  GetLayout,
  GetOverview,
  GetUsage,
  InstallPackContent,
  ListAlerts,
  ListAutomations,
  ListDeadLetters,
  ListKpis,
  PushRecommendation,
  RecordUsage,
  RefreshKpis,
  ReplayDeadLetters,
  SaveAutomation,
  SaveKpi,
  SaveLayout,
  type SituationDeps,
  UpdateAlert,
} from '../application';
import type {SituationRpc} from '../contract';

/** Builds the RPC surface over the use-case handlers. */
export function createSituationRpc(deps: SituationDeps): SituationRpc {
  const h = {
    overview: new GetOverview(deps),
    listKpis: new ListKpis(deps),
    saveKpi: new SaveKpi(deps),
    deleteKpi: new DeleteKpi(deps),
    kpiTrend: new GetKpiTrend(deps),
    refreshKpis: new RefreshKpis(deps),
    listAutomations: new ListAutomations(deps),
    saveAutomation: new SaveAutomation(deps),
    deleteAutomation: new DeleteAutomation(deps),
    dryRun: new DryRunAutomation(deps),
    listAlerts: new ListAlerts(deps),
    updateAlert: new UpdateAlert(deps),
    installPack: new InstallPackContent(deps),
    getLayout: new GetLayout(deps),
    saveLayout: new SaveLayout(deps),
    pushRecommendation: new PushRecommendation(deps),
    recordUsage: new RecordUsage(deps),
    getUsage: new GetUsage(deps),
    evaluateScheduled: new EvaluateScheduled(deps),
    listDeadLetters: new ListDeadLetters(deps),
    replayDeadLetters: new ReplayDeadLetters(deps),
  };
  return {
    overview: ctx => h.overview.execute(ctx),
    listKpis: ctx => h.listKpis.execute(ctx),
    saveKpi: (ctx, def) => h.saveKpi.execute(ctx, def),
    deleteKpi: (ctx, id) => h.deleteKpi.execute(ctx, id),
    kpiTrend: (ctx, id, range) => h.kpiTrend.execute(ctx, id, range),
    refreshKpis: ctx => h.refreshKpis.execute(ctx),
    listAutomations: ctx => h.listAutomations.execute(ctx),
    saveAutomation: (ctx, def) => h.saveAutomation.execute(ctx, def),
    deleteAutomation: (ctx, id) => h.deleteAutomation.execute(ctx, id),
    dryRunAutomation: (ctx, def) => h.dryRun.execute(ctx, def),
    listAlerts: (ctx, filter) => h.listAlerts.execute(ctx, filter),
    updateAlert: (ctx, id, patch) => h.updateAlert.execute(ctx, id, patch),
    installPackContent: (ctx, content) => h.installPack.execute(ctx, content),
    getLayout: ctx => h.getLayout.execute(ctx),
    saveLayout: (ctx, layout) => h.saveLayout.execute(ctx, layout),
    pushRecommendation: (ctx, dto) => h.pushRecommendation.execute(ctx, dto),
    recordUsage: batch => h.recordUsage.execute(batch),
    getUsage: ctx => h.getUsage.execute(ctx),
    evaluateScheduled: now => h.evaluateScheduled.execute(now),
    listDeadLetters: (ctx, queue) => h.listDeadLetters.execute(ctx, queue),
    replayDeadLetters: (ctx, queue, ids) =>
      h.replayDeadLetters.execute(ctx, queue, ids),
  };
}
