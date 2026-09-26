/**
 * @fileoverview Decision intelligence DTOs: scenarios, simulation results,
 * recommendations and mapping suggestions.
 */

import type {I18nText, Provenance, Rid} from '@ontodecide/shared-kernel';

/** Relative change −1..1 applied to one object property. */
export interface Perturbation {
  rid: Rid;
  property: string;
  change: number;
}

/** A concrete action candidate. */
export interface CandidateAction {
  actionType: string;
  displayName: I18nText;
  target: Rid;
  targetTitle: string;
  params: Record<string, unknown>;
  requiresApproval: boolean;
  /** Whether preconditions currently hold. */
  eligible: boolean;
  unmetPreconditions?: string[];
}

/** Values of simulation KPIs, keyed by KPI api name. */
export type KpiSet = Record<string, number>;

/** Simulation KPI metadata. */
export interface KpiMeta {
  apiName: string;
  displayName: I18nText;
  unit?: string;
  higherIsBetter: boolean;
}

/** Deterministic simulation result. Every number comes from the simulator. */
export interface ScenarioResult {
  baseline: KpiSet;
  scenario: KpiSet;
  /** Keyed by `${actionType}:${target}`. */
  withActions?: Record<string, KpiSet>;
  affected: {
    rid: Rid;
    type: string;
    title: string;
    delta: number;
    hop: number;
  }[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  kpis: KpiMeta[];
  nodeCount: number;
  degraded: boolean;
  computedAt: string;
}

/** Scenario input. */
export interface ScenarioInput {
  name?: string;
  perturbations: Perturbation[];
  candidateActions?: {
    actionType: string;
    target: Rid;
    params?: Record<string, unknown>;
  }[];
}

/** Stored scenario. */
export interface ScenarioDto {
  id: string;
  name: string;
  perturbations: Perturbation[];
  result?: ScenarioResult;
  createdBy: string;
  createdAt: string;
}

/** Recommendation lifecycle. */
export type RecStatus =
  | 'Draft'
  | 'Proposed'
  | 'Approved'
  | 'Rejected'
  | 'Expired'
  | 'Executed'
  | 'ExecFailed'
  | 'Evaluated'
  | 'Failed';

/** A recommended action with its simulated benefit. */
export interface RecommendedAction {
  actionType: string;
  displayName?: I18nText;
  target: Rid;
  params: Record<string, unknown>;
  /** Improvement of the primary KPI vs the scenario, relative (0.12 = +12%). */
  expectedImpact: number;
  rank: number;
  requiresApproval: boolean;
  execution?: {
    status: 'Executed' | 'Failed';
    actionLogId?: string;
    error?: string;
  };
}

/** Evidence item; clickable back to object property and lineage. */
export interface Evidence {
  rid: Rid;
  prop: string;
  value: unknown;
  provenance?: Provenance;
}

/** Recommendation. */
export interface RecommendationDto {
  id: string;
  status: RecStatus;
  focus: Rid;
  alertId?: string;
  scenarioId?: string;
  summary: string;
  rationale: string;
  actions: RecommendedAction[];
  evidence: Evidence[];
  risks: string[];
  confidence: number;
  /** Model id, or `rules` for the rule-based fallback. */
  model: string;
  degraded: boolean;
  simulation?: ScenarioResult;
  approvedBy?: string;
  decidedAt?: string;
  rejectReason?: string;
  feedback?: {rating: number; comment?: string};
  outcome?: {
    expected: number;
    actual: number;
    achievement: number;
    evaluatedAt: string;
  };
  locale: string;
  createdAt: string;
  expiresAt: string;
}

/** AI mapping suggestion (decision-engine does not know data sources). */
export interface MappingSuggestion {
  targetType: string;
  primaryKey: {from: string; transform?: string};
  fields: {to: string; from: string; transform?: string; confidence: number}[];
  model: string;
}

/** Target property description supplied with a mapping request. */
export interface TargetProp {
  apiName: string;
  dataType: string;
  displayName?: string;
}

/** Decision boundaries. */
export const DECISION_LIMITS = {
  perturbationsMax: 10,
  subgraphNodesMax: 500,
  maxHops: 3,
  gamma: 0.9,
  pruneBelow: 0.005,
  recExpireHoursDefault: 24,
  recExpireHoursMax: 72,
  llmTimeoutMs: 8000,
  llmCacheTtlMs: 3_600_000,
  userDailyLlmDefault: 20,
  tenantDailyLlmDefault: 50,
} as const;
