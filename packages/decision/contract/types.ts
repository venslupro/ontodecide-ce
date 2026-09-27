/**
 * @fileoverview Decision intelligence DTOs (详细设计 6.2, 6.11.5).
 *
 * Every number comes from the deterministic simulator. Candidates (action,
 * target and parameters) are generated deterministically and are immutable;
 * Workers AI only ranks candidate ids and writes the rationale.
 */

import type {I18nText, Provenance, Rid} from '@ontodecide/shared-kernel';

/** Relative change −1..1 applied to one object property. */
export interface Perturbation {
  rid: Rid;
  property: string;
  change: number;
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

/** A deterministic action candidate. `params` can never be changed later. */
export interface Candidate {
  /** Stable within a recommendation, e.g. `c1`. */
  id: string;
  actionType: string;
  displayName: I18nText;
  target: Rid;
  targetTitle: string;
  params: Record<string, unknown>;
  /** Improvement of the primary KPI vs the scenario (0.12 = +12%). */
  expectedImpact: number;
  /** Objects the action affects (for rule ranking tie-breaks). */
  affectedCount: number;
}

/** Deterministic simulation result. */
export interface ScenarioResult {
  baseline: KpiSet;
  scenario: KpiSet;
  /** Keyed by candidate id. */
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
  computedAt: string;
}

/** Candidate action requested for a scenario. */
export interface CandidateActionInput {
  actionType: string;
  target: Rid;
  params?: Record<string, unknown>;
}

/** POST /scenarios body. */
export interface ScenarioInput {
  name?: string;
  /** ≤ 10. */
  perturbations: Perturbation[];
  candidateActions?: CandidateActionInput[];
}

/** Stored scenario. */
export interface ScenarioDto {
  id: string;
  name: string;
  perturbations: Perturbation[];
  candidates: Candidate[];
  result: ScenarioResult;
  createdAt: string;
}

/** Recommendation lifecycle (详细设计 图 8). */
export type RecStatus =
  'Proposed' | 'Confirmed' | 'Rejected' | 'Expired' | 'Executed' | 'ExecFailed';

/** Evidence item; links back to the object property and its lineage. */
export interface Evidence {
  rid: Rid;
  prop: string;
  value: unknown;
  provenance?: Provenance;
}

/** Execution record of a confirmed recommendation. */
export interface ExecutionRecord {
  candidateId: string;
  status: 'Executed' | 'Failed';
  actionLogId?: string;
  error?: string;
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
  candidates: Candidate[];
  /** Candidate ids, best first. Confirmation executes ranking[0]. */
  ranking: string[];
  evidence: Evidence[];
  risks: string[];
  confidence: number;
  rankedBy: 'ai' | 'rules';
  /** Model id when rankedBy = ai. */
  model?: string;
  simulation?: ScenarioResult;
  decidedBy?: 'owner' | 'admin';
  decidedAt?: string;
  rejectReason?: string;
  execution?: ExecutionRecord[];
  locale: string;
  createdAt: string;
  expiresAt: string;
  version: number;
}

/** POST /recommendations body. */
export interface GenerateInput {
  focus: Rid;
  alertId?: string;
  scenarioId?: string;
}

/** POST /recommendations/{id}/decision body. */
export interface DecisionInput {
  decision: 'confirm' | 'reject';
  reason?: string;
}

/** Decision boundaries. */
export const DECISION_LIMITS = {
  perturbationsMax: 10,
  subgraphNodesMax: 300,
  maxHops: 2,
  gamma: 0.9,
  pruneBelow: 0.005,
  recExpireHours: 24,
  aiTimeoutMs: 8000,
  aiRecsDaily: 3,
  neuronsDailyBudget: 6500,
  neuronsReserveFactor: 1.3,
  execAttemptsMax: 3,
  candidatesMax: 3,
} as const;
