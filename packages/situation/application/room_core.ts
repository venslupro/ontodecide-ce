/**
 * @fileoverview SituationRoomCore: the whole logic of one SituationRoom
 * Durable Object as a plain class over its ports. The DO subclass in the
 * Worker only delegates (runtime sockets, alarm, fetch upgrade).
 */

import type {
  CallCtx,
  DomainEventMsg,
  PageRequest,
  PageResult,
  PurgeResult,
} from '@ontodecide/shared-kernel';
import type {
  AlertDto,
  AlertFilter,
  AutomationDef,
  AutomationDto,
  RecommendationSummary,
  SituationOverview,
  StreamTicket,
} from '../contract/types';
import {acknowledgeAlert, listAlerts} from './alert_handlers';
import {
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomations,
  putAutomation,
} from './automation_handlers';
import type {RoomDeps} from './deps';
import {type AlarmResult, runAlarm} from './evaluate_scheduled';
import {exportDocument, purgeRoom} from './lifecycle_handlers';
import {overview} from './overview';
import type {
  ApplyEventsResult,
  RedeemedTicket,
  RoomSocket,
  SituationRoomApi,
} from './ports';
import {applyEvents} from './process_situation_event';
import {pushRecommendation} from './push_recommendation';
import {resetForTemplate} from './install_pack_content';
import {
  closeStreams,
  issueStreamTicket,
  nextSocketNumber,
  onConnect,
  onMessage,
  redeemTicket,
} from './stream_handlers';
import {RoomRuntime} from './support';

/** Logic of one SituationRoom. */
export class SituationRoomCore implements SituationRoomApi {
  readonly rt: RoomRuntime;

  constructor(deps: RoomDeps) {
    this.rt = new RoomRuntime(deps);
    deps.store.migrate();
  }

  overview(ctx: CallCtx, q: {range: '24h' | '7d'}): Promise<SituationOverview> {
    return overview(this.rt, ctx, q);
  }

  listAlerts(
    ctx: CallCtx,
    filter: AlertFilter,
    page: PageRequest,
  ): Promise<PageResult<AlertDto>> {
    return listAlerts(this.rt, ctx, filter ?? {}, page ?? {});
  }

  acknowledgeAlert(ctx: CallCtx, id: string): Promise<AlertDto> {
    return acknowledgeAlert(this.rt, ctx, id);
  }

  listAutomations(ctx: CallCtx): Promise<AutomationDto[]> {
    return listAutomations(this.rt, ctx);
  }

  getAutomation(ctx: CallCtx, id: string): Promise<AutomationDto> {
    return getAutomation(this.rt, ctx, id);
  }

  createAutomation(ctx: CallCtx, def: AutomationDef): Promise<AutomationDto> {
    return createAutomation(this.rt, ctx, def);
  }

  putAutomation(
    ctx: CallCtx,
    id: string,
    def: AutomationDef,
    ifMatch: number,
  ): Promise<AutomationDto> {
    return putAutomation(this.rt, ctx, id, def, ifMatch);
  }

  deleteAutomation(ctx: CallCtx, id: string, ifMatch: number): Promise<void> {
    return deleteAutomation(this.rt, ctx, id, ifMatch);
  }

  issueStreamTicket(ctx: CallCtx): Promise<StreamTicket> {
    return issueStreamTicket(this.rt, ctx);
  }

  pushRecommendation(ctx: CallCtx, rec: RecommendationSummary): Promise<void> {
    return pushRecommendation(this.rt, ctx, rec);
  }

  resetForTemplate(ctx: CallCtx): Promise<void> {
    return resetForTemplate(this.rt, ctx);
  }

  applyEvents(
    tid: string,
    events: DomainEventMsg[],
  ): Promise<ApplyEventsResult> {
    return applyEvents(this.rt, tid, events);
  }

  async exportTenant(_tid: string): Promise<string> {
    return exportDocument(this.rt);
  }

  purgeTenant(_tid: string): Promise<PurgeResult> {
    return purgeRoom(this.rt);
  }

  async countTenant(_tid: string): Promise<number> {
    return this.rt.deps.store.countRows();
  }

  closeStreams(_tid: string, code: number): Promise<void> {
    return closeStreams(this.rt, code);
  }

  // --- Runtime hooks (called by the Durable Object wrapper) ---------------

  /** Redeems a stream ticket (null → 401). */
  redeemTicket(ticket: string | null): Promise<RedeemedTicket | null> {
    return redeemTicket(this.rt, ticket);
  }

  /** Connection number for a new socket's attachment. */
  nextSocketNumber(): number {
    return nextSocketNumber(this.rt);
  }

  /** A socket was accepted. */
  connected(socket: RoomSocket): Promise<void> {
    return onConnect(this.rt, socket);
  }

  /** A client frame arrived. */
  message(socket: RoomSocket, text: string): Promise<void> {
    return onMessage(this.rt, socket, text);
  }

  /** The DO alarm fired. */
  alarm(): Promise<AlarmResult> {
    return runAlarm(this.rt);
  }
}
