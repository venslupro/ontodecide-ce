/**
 * @fileoverview Worker entry point of situation-awareness: the RPC
 * entrypoint, the Durable Object classes and the fetch / queue / cron
 * handlers.
 */

import {WorkerEntrypoint} from 'cloudflare:workers';
import type {
  CallCtx,
  QueueBatch,
  ServiceModule,
  UsageResource,
} from '@ontodecide/shared-kernel';
import type {
  AlertFilter,
  AutomationDef,
  CockpitLayout,
  KpiDef,
  RecommendationSummary,
  SituationRpc as Contract,
} from '@ontodecide/situation/contract';
import type {Env} from './env';
import {createService} from './service';

export {SituationRoom, UsageGuard} from './durable_objects';

let cache: {env: Env; svc: ServiceModule<Contract>} | undefined;
const svc = (env: Env): ServiceModule<Contract> =>
  cache?.env === env ? cache.svc : (cache = {env, svc: createService(env)}).svc;

/** Service-binding RPC entrypoint (`entrypoint: "SituationRpc"`). */
export class SituationRpc extends WorkerEntrypoint<Env> implements Contract {
  private get rpc(): Contract {
    return svc(this.env).rpc;
  }
  /**
   * WebSocket stream forwarded by api-gateway. The gateway's SITUATION
   * binding targets this named entrypoint, so it must handle fetch too.
   */
  override fetch(request: Request): Promise<Response> {
    return svc(this.env).fetch!(request);
  }
  overview(ctx: CallCtx) {
    return this.rpc.overview(ctx);
  }
  listKpis(ctx: CallCtx) {
    return this.rpc.listKpis(ctx);
  }
  saveKpi(ctx: CallCtx, def: KpiDef) {
    return this.rpc.saveKpi(ctx, def);
  }
  deleteKpi(ctx: CallCtx, id: string) {
    return this.rpc.deleteKpi(ctx, id);
  }
  kpiTrend(ctx: CallCtx, id: string, range: '24h' | '7d') {
    return this.rpc.kpiTrend(ctx, id, range);
  }
  refreshKpis(ctx: CallCtx) {
    return this.rpc.refreshKpis(ctx);
  }
  listAutomations(ctx: CallCtx) {
    return this.rpc.listAutomations(ctx);
  }
  saveAutomation(ctx: CallCtx, def: AutomationDef) {
    return this.rpc.saveAutomation(ctx, def);
  }
  deleteAutomation(ctx: CallCtx, id: string) {
    return this.rpc.deleteAutomation(ctx, id);
  }
  dryRunAutomation(ctx: CallCtx, def: AutomationDef) {
    return this.rpc.dryRunAutomation(ctx, def);
  }
  listAlerts(ctx: CallCtx, filter?: AlertFilter) {
    return this.rpc.listAlerts(ctx, filter);
  }
  updateAlert(ctx: CallCtx, id: string, patch: {status: 'ACKED' | 'CLOSED'}) {
    return this.rpc.updateAlert(ctx, id, patch);
  }
  installPackContent(
    ctx: CallCtx,
    content: {automations?: unknown[]; kpis?: unknown[]},
  ) {
    return this.rpc.installPackContent(ctx, content);
  }
  getLayout(ctx: CallCtx) {
    return this.rpc.getLayout(ctx);
  }
  saveLayout(ctx: CallCtx, layout: CockpitLayout) {
    return this.rpc.saveLayout(ctx, layout);
  }
  pushRecommendation(ctx: CallCtx, dto: RecommendationSummary) {
    return this.rpc.pushRecommendation(ctx, dto);
  }
  recordUsage(batch: {resource: UsageResource; n: number}[]) {
    return this.rpc.recordUsage(batch);
  }
  getUsage(ctx: CallCtx) {
    return this.rpc.getUsage(ctx);
  }
  evaluateScheduled(now: string) {
    return this.rpc.evaluateScheduled(now);
  }
  listDeadLetters(ctx: CallCtx, queue?: string) {
    return this.rpc.listDeadLetters(ctx, queue);
  }
  replayDeadLetters(ctx: CallCtx, queue: string, ids?: string[]) {
    return this.rpc.replayDeadLetters(ctx, queue, ids);
  }
}

export default {
  fetch: (request, env) => svc(env).fetch!(request),
  queue: (batch, env) =>
    svc(env).queue!(batch as unknown as QueueBatch<unknown>),
  scheduled: (event, env, ctx) =>
    ctx.waitUntil(
      svc(env).scheduled!(event.cron, new Date(event.scheduledTime)),
    ),
} satisfies ExportedHandler<Env>;
