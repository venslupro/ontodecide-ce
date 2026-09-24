/**
 * @fileoverview Situation awareness DTOs: KPIs, automations, alerts,
 * cockpit layout, realtime messages and dead letters.
 */

import type {
  CallCtx,
  FilterExpr,
  I18nText,
  ObjectSetDef,
  Rid,
  UsageStatus,
} from '@ontodecide/shared-kernel';

/** KPI aggregation function. */
export type KpiAggregate = {
  fn: 'count' | 'sum' | 'avg' | 'min' | 'max';
  prop?: string;
};

/** KPI definition. */
export interface KpiDef {
  id?: string;
  name: I18nText;
  objectSet: ObjectSetDef;
  aggregate: KpiAggregate;
  unit?: string;
  target?: number;
  higherIsBetter?: boolean;
}

/** KPI with its current value. */
export interface KpiValue {
  id: string;
  name: I18nText;
  value: number | null;
  /** Value 24h ago (for ▲▼ change). */
  previous: number | null;
  target: number | null;
  unit: string | null;
  higherIsBetter: boolean;
  /** Up to 24 hourly points. */
  spark: number[];
  updatedAt: string | null;
}

/** Trend point. */
export interface MetricPoint {
  ts: string;
  value: number;
}

/** Alert severity. */
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Automation trigger. */
export type AutomationTrigger =
  /** Evaluated on each change of objects of `objectType`. */
  | {kind: 'threshold'; objectType: string}
  /** Fires when the Object Set size crosses the threshold. */
  | {
      kind: 'objectSetCount';
      objectSet: ObjectSetDef;
      op: 'gt' | 'lt';
      value: number;
    }
  /** Evaluated hourly over every object of `objectSet`. */
  | {kind: 'schedule'; objectSet: ObjectSetDef};

/** Automation effect. */
export type AutomationEffect =
  | {kind: 'alert'}
  /** Queues a recommendation job; the perturbation seeds the simulation. */
  | {kind: 'recommend'; perturbation?: {property: string; change: number}}
  /** Executes an action that does not require approval. */
  | {kind: 'action'; actionType: string; params?: Record<string, unknown>};

/** Automation rule (Palantir Automate equivalent). */
export interface AutomationDef {
  id?: string;
  name: I18nText;
  trigger: AutomationTrigger;
  condition?: FilterExpr;
  effects: AutomationEffect[];
  severity: Severity;
  /** 0..86400, default 3600. */
  cooldownSec?: number;
  enabled?: boolean;
}

/** Stored automation. */
export interface AutomationDto extends AutomationDef {
  id: string;
  cooldownSec: number;
  enabled: boolean;
  createdAt: string;
  lastFiredAt?: string;
}

/** Alert lifecycle state. */
export type AlertStatus = 'OPEN' | 'ACKED' | 'CLOSED';

/** Alert. */
export interface AlertDto {
  id: string;
  automationId: string;
  automationName: I18nText;
  rid: Rid | null;
  title: string;
  severity: Severity;
  status: AlertStatus;
  /** Object properties at raise time (latest hit while open/cooling). */
  snapshot: Record<string, unknown>;
  hits: number;
  raisedAt: string;
  ackedBy?: string;
  closedAt?: string;
  recommendationId?: string;
}

/** Alert list filter. */
export interface AlertFilter {
  status?: AlertStatus;
  severity?: Severity;
  rid?: Rid;
  limit?: number;
}

/** Recommendation summary pushed to the cockpit by decision-engine. */
export interface RecommendationSummary {
  id: string;
  status: string;
  summary: string;
  confidence: number;
  focus: Rid;
  alertId?: string;
  expectedImpact: number;
  createdAt: string;
  expiresAt?: string;
  degraded?: boolean;
}

/** Cockpit first-screen data owned by situation-awareness. */
export interface SituationOverview {
  kpis: KpiValue[];
  alerts: AlertDto[];
  usage: UsageStatus;
  recommendations: RecommendationSummary[];
  generatedAt: string;
}

/** Realtime message pushed over the WebSocket. */
export interface WsMsg {
  seq: number;
  type: 'snapshot' | 'kpi' | 'alert' | 'recommendation' | 'usage';
  data: unknown;
  occurredAt: string;
}

/** Cockpit widget. */
export interface CockpitWidget {
  id: string;
  kind:
    | 'kpi'
    | 'trend'
    | 'alerts'
    | 'recommendations'
    | 'objectTable'
    | 'dataHealth'
    | 'impacted';
  x: number;
  y: number;
  w: number;
  h: number;
  binding?: {kpiId?: string; objectSetId?: string};
}

/** Workshop-style cockpit layout (12 columns). */
export interface CockpitLayout {
  id: string;
  name: string;
  columns: 12;
  widgets: CockpitWidget[];
}

/** Dead-lettered queue message kept for inspection and replay. */
export interface DeadLetterDto {
  id: string;
  queue: string;
  body: unknown;
  attempts: number;
  receivedAt: string;
  replayedAt?: string;
}

/** Message on the `decision-jobs` queue (produced here and by decision-engine). */
export interface DecisionJobMsg {
  ctx: CallCtx;
  /** Equals the recommendation id. */
  jobId: string;
  alertId?: string;
  scenarioId?: string;
  focus: Rid;
  perturbation?: {property: string; change: number};
  locale?: string;
}

/** Usage thresholds. */
export const USAGE_THRESHOLDS = {warn: 0.8, stop: 0.95} as const;
