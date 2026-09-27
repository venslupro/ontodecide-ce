/**
 * @fileoverview Ports of the situation application layer: the room's local
 * store (SituationRoom SQLite), the Durable Object storage / alarm and
 * socket runtime, the upstream services, and the RPC surface of a room.
 */

import type {
  CallCtx,
  DomainEventMsg,
  I18nText,
  PageRequest,
  PageResult,
  PurgeResult,
} from '@ontodecide/shared-kernel';
import type {ObjectGraphRpc} from '@ontodecide/object-graph/contract';
import type {OntologyRpc} from '@ontodecide/ontology/contract';
import type {
  AlertDto,
  AlertFilter,
  AlertStatus,
  AutomationDef,
  AutomationDto,
  RecommendationSummary,
  Severity,
  SituationOverview,
  StreamTicket,
  WsMsg,
} from '../contract/types';
import type {KpiDefinition, KpiState, ObjectView, SocketMeta} from '../domain';

/** Stored automation. Times are Unix ms. */
export interface AutomationRecord extends AutomationDef {
  id: string;
  version: number;
  nextRunAt: number | null;
  lastFiredAt: number | null;
  createdAt: number;
}

/** Stored alert. Times are Unix ms. */
export interface AlertRecord {
  id: string;
  automationId: string;
  automationName: I18nText;
  rid: string | null;
  title: string;
  severity: Severity;
  status: AlertStatus;
  snapshot: Record<string, unknown>;
  hits: number;
  raisedAt: number;
  ackedAt: number | null;
  closedAt: number | null;
}

/** KPI definition with its aggregation state. */
export interface KpiRecord extends KpiDefinition {
  state: KpiState;
  updatedAt: number | null;
}

/** A trend point. */
export interface PointRecord {
  metric: string;
  ts: number;
  value: number;
}

/** A buffered realtime message. */
export interface OutboxRecord {
  seq: number;
  type: WsMsg['type'];
  data: unknown;
  occurredAt: number;
}

/** A redeemed stream ticket. */
export interface TicketRecord {
  sub: string;
  actingAs: boolean;
  expiresAt: number;
}

/** Keyset cursor of the alert list. */
export interface AlertCursor {
  t: number;
  i: string;
}

/**
 * Local store of one SituationRoom (its SQLite database). All methods are
 * synchronous, like Durable Object SQL storage, so a sequence of calls
 * without `await` in between is atomic within the room.
 */
export interface RoomStore {
  /**
   * Prepares the schema: V1.3 tables are dropped when the schema version
   * key differs. Does nothing when the room holds a tombstone.
   */
  migrate(): void;
  /** Tombstone expiry (Unix ms), or null. Never creates tables. */
  tombstoneUntil(): number | null;
  /** Writes only the tombstone key (the store must be empty). */
  writeTombstone(until: number): void;
  getMeta(key: string): string | null;
  setMeta(key: string, value: string): void;
  deleteMeta(key: string): void;
  /** Rows held for the workspace (excluding the meta table). */
  countRows(): number;

  listKpis(): KpiRecord[];
  insertKpi(
    def: KpiDefinition,
    state: KpiState,
    now: number,
    ord: number,
  ): void;
  saveKpiState(id: string, state: KpiState, now: number): void;

  lastPoint(metric: string): PointRecord | null;
  pointAtOrBefore(metric: string, ts: number): PointRecord | null;
  putPoint(p: PointRecord): void;
  listPoints(sinceTs: number): PointRecord[];
  /** Deletes points older than `beforeTs`, keeping the latest per metric. */
  prunePoints(beforeTs: number): void;

  getObject(rid: string): ObjectView | null;
  listObjects(type?: string): ObjectView[];
  putObject(o: ObjectView): void;
  deleteObject(rid: string): void;

  listAutomations(): AutomationRecord[];
  getAutomation(id: string): AutomationRecord | null;
  insertAutomation(a: AutomationRecord): void;
  updateAutomation(a: AutomationRecord): void;
  deleteAutomation(id: string): void;
  countScheduled(excludeId?: string): number;
  /** Records when a rule last raised or updated an alert. */
  setLastFired(id: string, at: number): void;

  activeAlert(automationId: string, rid: string): AlertRecord | null;
  lastClosedAlert(automationId: string, rid: string): AlertRecord | null;
  activeAlertsOf(automationId: string): AlertRecord[];
  activeAlertsFor(rid: string): AlertRecord[];
  getAlert(id: string): AlertRecord | null;
  insertAlert(a: AlertRecord): void;
  updateAlert(a: AlertRecord): void;
  listAlerts(
    filter: AlertFilter,
    after: AlertCursor | null,
    limit: number,
  ): AlertRecord[];
  /** OPEN / ACKED alerts, most severe first. */
  activeAlerts(limit: number): AlertRecord[];
  allAlerts(): AlertRecord[];

  isSeen(eventId: string): boolean;
  markSeen(eventId: string, at: number): void;
  pruneSeen(beforeTs: number): void;

  insertTicket(hash: string, t: TicketRecord): void;
  /** Deletes and returns the ticket (single use). */
  takeTicket(hash: string): TicketRecord | null;
  pruneTickets(now: number): void;

  appendWs(type: WsMsg['type'], data: unknown, at: number): number;
  wsBounds(): {minSeq: number; maxSeq: number};
  wsSince(afterSeq: number): OutboxRecord[];
  /** Keeps the newest `keep` messages. */
  pruneWs(keep: number): void;
}

/** Durable Object storage operations beyond SQL. */
export interface RoomStorage {
  /** Deletes every stored row (storage.deleteAll()). */
  deleteAll(): Promise<void>;
  getAlarm(): Promise<number | null>;
  setAlarm(at: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

/** An accepted realtime connection (abstracts a hibernatable WebSocket). */
export interface RoomSocket {
  readonly meta: SocketMeta;
  send(text: string): void;
  close(code: number, reason: string): void;
}

/** The room's accepted sockets. */
export interface SocketHub {
  /** Sockets of a user (tag = sub), or all when `sub` is omitted. */
  list(sub?: string): RoomSocket[];
}

/** Upstream object-graph calls. */
export type ObjectsPort = Pick<ObjectGraphRpc, 'getObjects' | 'listObjects'>;

/** Upstream ontology-manager calls. */
export type OntologyPort = Pick<
  OntologyRpc,
  'getCompiledSchema' | 'getTemplateSeeds'
>;

/** Outcome of applying a group of domain events. */
export interface ApplyEventsResult {
  applied: number;
  duplicates: number;
  /** True when the room is tombstoned and the events were dropped. */
  dropped: boolean;
}

/** Stream ticket redemption result. */
export interface RedeemedTicket {
  sub: string;
  actingAs: boolean;
}

/**
 * RPC surface of a SituationRoom (called by the Worker through the Durable
 * Object stub). Business calls carry the CallCtx; `tid` of lifecycle and
 * queue calls is the room's workspace.
 */
export interface SituationRoomApi {
  overview(ctx: CallCtx, q: {range: '24h' | '7d'}): Promise<SituationOverview>;
  listAlerts(
    ctx: CallCtx,
    filter: AlertFilter,
    page: PageRequest,
  ): Promise<PageResult<AlertDto>>;
  acknowledgeAlert(ctx: CallCtx, id: string): Promise<AlertDto>;
  listAutomations(ctx: CallCtx): Promise<AutomationDto[]>;
  getAutomation(ctx: CallCtx, id: string): Promise<AutomationDto>;
  createAutomation(ctx: CallCtx, def: AutomationDef): Promise<AutomationDto>;
  putAutomation(
    ctx: CallCtx,
    id: string,
    def: AutomationDef,
    ifMatch: number,
  ): Promise<AutomationDto>;
  deleteAutomation(ctx: CallCtx, id: string, ifMatch: number): Promise<void>;
  issueStreamTicket(ctx: CallCtx): Promise<StreamTicket>;
  pushRecommendation(ctx: CallCtx, rec: RecommendationSummary): Promise<void>;
  applyEvents(
    tid: string,
    events: DomainEventMsg[],
  ): Promise<ApplyEventsResult>;
  /** The `situation.json` document. */
  exportTenant(tid: string): Promise<string>;
  purgeTenant(tid: string): Promise<PurgeResult>;
  countTenant(tid: string): Promise<number>;
  closeStreams(tid: string, code: number): Promise<void>;
}
