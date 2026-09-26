/**
 * @fileoverview Ports of the situation application layer: repositories,
 * the per-tenant SituationRoom, the global UsageGuard and queue producers.
 */

import type {Rid, UsageResource, UsageStatus} from '@ontodecide/shared-kernel';
import type {
  AlertDto,
  AlertFilter,
  AlertStatus,
  AutomationDto,
  CockpitLayout,
  DeadLetterDto,
  KpiDef,
  RecommendationSummary,
  Severity,
  WsMsg,
} from '../contract';
import type {LatestAlert, RawPoint} from '../domain';

/** Stored KPI definition with its last computed value. */
export interface KpiRecord extends KpiDef {
  id: string;
  value: number | null;
  /** Epoch ms. */
  updatedAt: number | null;
  createdAt: number;
}

/** KPI definitions (sit_kpi). */
export interface KpiRepository {
  list(tenantId: string): Promise<KpiRecord[]>;
  get(tenantId: string, id: string): Promise<KpiRecord | null>;
  save(tenantId: string, kpi: KpiRecord): Promise<void>;
  setValue(
    tenantId: string,
    id: string,
    value: number | null,
    at: number,
  ): Promise<void>;
  delete(tenantId: string, id: string): Promise<boolean>;
  tenants(): Promise<string[]>;
}

/** 5-minute metric points (sit_metric_point). */
export interface MetricRepository {
  upsert(
    tenantId: string,
    metric: string,
    ts: number,
    value: number,
  ): Promise<void>;
  range(
    tenantId: string,
    metrics: string[],
    fromMs: number,
    toMs: number,
  ): Promise<Map<string, RawPoint[]>>;
  deleteMetric(tenantId: string, metric: string): Promise<void>;
  /** Maintenance across tenants (TTL). */
  deleteOlderThan(ts: number): Promise<number>;
}

/** Automation rules (sit_automation). */
export interface AutomationRepository {
  list(tenantId: string): Promise<AutomationDto[]>;
  get(tenantId: string, id: string): Promise<AutomationDto | null>;
  save(tenantId: string, dto: AutomationDto): Promise<void>;
  delete(tenantId: string, id: string): Promise<boolean>;
  markFired(tenantId: string, id: string, at: number): Promise<void>;
  tenants(): Promise<string[]>;
}

/** New alert row. */
export interface NewAlert {
  id: string;
  automationId: string;
  rid: Rid | null;
  title: string;
  severity: Severity;
  snapshot: Record<string, unknown>;
  raisedAt: number;
}

/** Alerts (sit_alert). */
export interface AlertRepository {
  /** Inserts an OPEN alert; returns false on a unique-index conflict. */
  insertOpen(tenantId: string, alert: NewAlert): Promise<boolean>;
  latestFor(
    tenantId: string,
    automationId: string,
    rid: Rid | null,
  ): Promise<LatestAlert | null>;
  /** Increments hits and replaces the snapshot. */
  hit(
    tenantId: string,
    id: string,
    snapshot: Record<string, unknown>,
  ): Promise<void>;
  get(tenantId: string, id: string): Promise<AlertDto | null>;
  list(tenantId: string, filter?: AlertFilter): Promise<AlertDto[]>;
  /** Non-closed alerts sorted by severity then raise time (newest first). */
  listActive(tenantId: string, limit: number): Promise<AlertDto[]>;
  setStatus(
    tenantId: string,
    id: string,
    status: AlertStatus,
    patch: {ackedBy?: string; closedAt?: number},
  ): Promise<void>;
  linkRecommendation(
    tenantId: string,
    id: string,
    recommendationId: string,
  ): Promise<boolean>;
  /** Maintenance across tenants (TTL). */
  deleteClosedBefore(ts: number): Promise<number>;
}

/** Recommendation summaries pushed by decision-engine (sit_recommendation). */
export interface RecommendationRepository {
  upsert(
    tenantId: string,
    dto: RecommendationSummary,
    at: number,
  ): Promise<void>;
  listByStatus(
    tenantId: string,
    status: string,
    limit: number,
  ): Promise<RecommendationSummary[]>;
}

/** Cockpit layouts (sit_layout). */
export interface LayoutRepository {
  latest(tenantId: string): Promise<CockpitLayout | null>;
  save(tenantId: string, layout: CockpitLayout, at: number): Promise<void>;
}

/** New dead letter row. */
export interface NewDeadLetter {
  id: string;
  queue: string;
  tenantId: string | null;
  body: unknown;
  attempts: number;
  receivedAt: number;
}

/** Dead letters (sit_dead_letter). */
export interface DeadLetterRepository {
  /** Inserts, ignoring ids already stored (redelivery). */
  insert(letters: NewDeadLetter[]): Promise<void>;
  list(
    tenantId: string,
    opts: {
      queue?: string;
      pendingOnly?: boolean;
      ids?: string[];
      limit: number;
      /** Oldest first (replay order); default newest first. */
      oldestFirst?: boolean;
    },
  ): Promise<DeadLetterDto[]>;
  markReplayed(ids: string[], at: number): Promise<void>;
}

/** Processed situation-events (sit_processed_event). */
export interface ProcessedEventRepository {
  has(eventId: string): Promise<boolean>;
  add(eventId: string, at: number): Promise<void>;
  deleteOlderThan(ts: number): Promise<number>;
}

/** Daily usage snapshots (sit_usage_day). */
export interface UsageDayRepository {
  save(
    day: string,
    used: Partial<Record<UsageResource, number>>,
  ): Promise<void>;
}

/** Every repository. */
export interface SituationRepositories {
  kpis: KpiRepository;
  metrics: MetricRepository;
  automations: AutomationRepository;
  alerts: AlertRepository;
  recommendations: RecommendationRepository;
  layouts: LayoutRepository;
  deadLetters: DeadLetterRepository;
  processedEvents: ProcessedEventRepository;
}

/** Realtime message type. */
export type WsMsgType = WsMsg['type'];

/**
 * Per-tenant SituationRoom (Durable Object). Implemented by
 * SituationRoomCore and by the DO stub (RPC methods).
 */
export interface SituationRoomApi {
  /**
   * Updates the room state (kpi / alert) and pushes the message to every
   * connected socket. A `kpi` payload `{id, deleted: true}` removes a KPI;
   * a CLOSED alert leaves the open-alert set.
   */
  publish(type: Exclude<WsMsgType, 'snapshot'>, data: unknown): Promise<WsMsg>;
  /** Current state as a `snapshot` message (seq = last published seq). */
  snapshot(): Promise<WsMsg>;
  /** Messages after `lastSeq`; null when the gap exceeds the retained window. */
  since(lastSeq: number): Promise<WsMsg[] | null>;
}

/** Global free-tier counter (Durable Object named `global`). */
export interface UsageGuardApi {
  record(batch: {resource: UsageResource; n: number}[]): Promise<UsageStatus>;
  status(): Promise<UsageStatus>;
}

/** Resolves the SituationRoom of a tenant. */
export type RoomProvider = (tenantId: string) => SituationRoomApi;

/** Resolves the UsageGuard. */
export type UsageGuardProvider = () => UsageGuardApi;

/** Name of the single UsageGuard instance. */
export const USAGE_GUARD_NAME = 'global';
