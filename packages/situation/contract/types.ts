/**
 * @fileoverview Situation awareness DTOs (详细设计 6.11.4). One SituationRoom
 * Durable Object per workspace holds KPIs, automations, alerts, stream
 * tickets and WebSocket connections in its SQLite storage (no D1, no cron).
 */

import type {FilterExpr, I18nText, Rid} from '@ontodecide/shared-kernel';
import type {AutomationSeed, KpiAggregate} from '@ontodecide/ontology/contract';

/** Alert severity. */
export type Severity = AutomationSeed['severity'];

/** KPI with its current value. */
export interface KpiValue {
  id: string;
  name: I18nText;
  objectType: string;
  aggregate: KpiAggregate;
  value: number | null;
  /** Value 24 h ago (for ▲▼). */
  previous: number | null;
  target: number | null;
  unit: string | null;
  higherIsBetter: boolean;
  updatedAt: string | null;
}

/** Trend point (15-minute resolution; written only when the value changes). */
export interface MetricPoint {
  ts: string;
  value: number;
}

/** Trend series of one KPI. */
export interface KpiTrend {
  kpiId: string;
  points: MetricPoint[];
}

/** Automation definition (alert-only; 修订说明书 12.2). */
export interface AutomationDef {
  name: I18nText;
  trigger: 'threshold' | 'schedule';
  objectType: string;
  condition: FilterExpr;
  /** `schedule` only: interval hours ≥ 1; ≤ 3 scheduled rules per workspace. */
  everyHours?: number;
  severity: Severity;
  /** 0..86400, default 3600. */
  cooldownSec: number;
  enabled: boolean;
}

/** Stored automation (`version` → ETag). */
export interface AutomationDto extends AutomationDef {
  id: string;
  version: number;
  nextRunAt: string | null;
  lastFiredAt: string | null;
}

/** Alert lifecycle state. */
export type AlertStatus = 'OPEN' | 'ACKED' | 'CLOSED';

/** Alert. At most one OPEN alert per (automation, rid). */
export interface AlertDto {
  id: string;
  automationId: string;
  automationName: I18nText;
  rid: Rid | null;
  title: string;
  severity: Severity;
  status: AlertStatus;
  /** Object properties at the latest hit. */
  snapshot: Record<string, unknown>;
  hits: number;
  raisedAt: string;
  ackedAt: string | null;
  closedAt: string | null;
}

/** Alert list filter. */
export interface AlertFilter {
  status?: AlertStatus;
  severity?: Severity;
  rid?: Rid;
}

/** Objects most affected by the latest recommendation's simulation. */
export interface ImpactedObject {
  rid: Rid;
  type: string;
  title: string;
  delta: number;
  hop: number;
}

/** Recommendation summary pushed to the cockpit by decision-engine. */
export interface RecommendationSummary {
  id: string;
  status: string;
  summary: string;
  confidence: number;
  rankedBy: 'ai' | 'rules';
  focus: Rid;
  expectedImpact: number;
  createdAt: string;
  expiresAt: string;
  impacted?: ImpactedObject[];
}

/** Situation part of GET /situation/overview. */
export interface SituationOverview {
  kpis: KpiValue[];
  trends: KpiTrend[];
  /** Open and acknowledged alerts, most severe first (≤ 50). */
  alerts: AlertDto[];
  impacted: ImpactedObject[];
  /** False until the room has initialized KPIs from the template. */
  initialized: boolean;
  generatedAt: string;
}

/** Realtime message (heartbeats are protocol-level ping/pong, not listed). */
export interface WsMsg {
  seq: number;
  type: 'snapshot' | 'kpi' | 'alert' | 'recommendation' | 'trial';
  data: unknown;
  occurredAt: string;
}

/** Stream ticket (30 s, single use; format `{tid}.{random}`). */
export interface StreamTicket {
  ticket: string;
  expiresIn: 30;
}

/** Replay window for resumed connections. */
export const WS_REPLAY_MAX = 200;
