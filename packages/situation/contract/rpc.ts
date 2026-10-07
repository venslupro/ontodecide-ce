/**
 * @fileoverview RPC contract of situation-awareness (SituationRpc entry
 * point). Depends on object-graph and ontology-manager; consumes
 * domain-events.
 *
 * The entry point also implements `fetch` for the WebSocket upgrade
 * `GET /api/v1/situation/stream?ticket=` forwarded by api-gateway (after
 * its Origin check); the ticket's `{tid}` prefix selects the room.
 */

import type {CallCtx, PageRequest, PageResult} from '@ontodecide/shared-kernel';
import type {
  AlertDto,
  AlertFilter,
  AutomationDef,
  AutomationDto,
  RecommendationSummary,
  SituationOverview,
  StreamTicket,
} from './types';

/** situation-awareness RPC surface. */
export interface SituationRpc {
  /**
   * Cockpit data; the first call initializes KPIs and sample automations
   * from the template seeds.
   */
  overview(ctx: CallCtx, q: {range: '24h' | '7d'}): Promise<SituationOverview>;
  listAlerts(
    ctx: CallCtx,
    filter: AlertFilter,
    page: PageRequest,
  ): Promise<PageResult<AlertDto>>;
  acknowledgeAlert(ctx: CallCtx, id: string): Promise<AlertDto>;
  listAutomations(ctx: CallCtx): Promise<AutomationDto[]>;
  getAutomation(ctx: CallCtx, id: string): Promise<AutomationDto>;
  /** VALIDATION_FAILED when a 4th scheduled rule or < 1 h interval. */
  createAutomation(ctx: CallCtx, def: AutomationDef): Promise<AutomationDto>;
  /** `ifMatch` is the automation version; mismatch → PRECONDITION_FAILED. */
  putAutomation(
    ctx: CallCtx,
    id: string,
    def: AutomationDef,
    ifMatch: number,
  ): Promise<AutomationDto>;
  deleteAutomation(ctx: CallCtx, id: string, ifMatch: number): Promise<void>;
  /** 30-second single-use ticket bound to sub, tid and Act-as. */
  issueStreamTicket(ctx: CallCtx): Promise<StreamTicket>;
  /** Called by decision-engine when a recommendation is created or decided. */
  pushRecommendation(ctx: CallCtx, rec: RecommendationSummary): Promise<void>;
  /** Reloads the room's KPIs and sample automations after a template switch. */
  resetForTemplate(ctx: CallCtx): Promise<void>;
}
