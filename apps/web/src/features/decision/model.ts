/**
 * @fileoverview Pure view-model helpers for scenario simulation and the
 * recommendation center (V2.4): status mapping, filter tabs, model names,
 * candidate ordering, KPI deltas, impact graph construction and the
 * perturbation draft → `ScenarioInput` mapping. Every number shown comes
 * from the deterministic simulator; these helpers only derive presentation
 * values (relative deltas, normalized intensities).
 */

import {
  type Candidate,
  type CandidateActionInput,
  DECISION_LIMITS,
  type KpiMeta,
  type KpiSet,
  type RecStatus,
  type RecommendationDto,
  type ScenarioInput,
  type ScenarioResult,
} from '@ontodecide/decision/contract';
import type {GraphEdge} from '@ontodecide/object-graph/contract';
import type {Rid} from '@ontodecide/shared-kernel';
import type {UiActionType, UiModel} from '../../entities/schema/model';
import {typeOfRid} from '../../entities/schema/model';
import type {StatusLevel} from '../../shared/ui/badge';
import type {GEdge, GNode} from '../../shared/graph/limit';

// --- Recommendation center ---------------------------------------------------

/** Filter tabs of the recommendation center, in display order. */
export const REC_TABS = ['pending', 'executed', 'all'] as const;

/** One filter tab. */
export type RecTab = (typeof REC_TABS)[number];

/** Status sent to `GET /recommendations` for a tab (undefined = all). */
export function tabStatus(tab: RecTab): RecStatus | undefined {
  if (tab === 'pending') return 'Proposed';
  if (tab === 'executed') return 'Executed';
  return undefined;
}

/** Normalizes a `?tab=` search value (default `pending`). */
export function toRecTab(v: unknown): RecTab {
  return (REC_TABS as readonly unknown[]).includes(v)
    ? (v as RecTab)
    : 'pending';
}

/** Badge level of a recommendation status (rendered with icon + text). */
export function recStatusLevel(s: RecStatus): StatusLevel {
  switch (s) {
    case 'Executed':
    case 'Confirmed':
      return 'good';
    case 'Proposed':
      return 'warn';
    case 'ExecFailed':
      return 'crit';
    default:
      return 'info';
  }
}

/** Whether the Owner can still confirm or reject. */
export function isDecidable(r: Pick<RecommendationDto, 'status'>): boolean {
  return r.status === 'Proposed';
}

/**
 * Short model name for the ranked-by badge:
 * `@cf/qwen/qwen3-30b-a3b-fp8` → `qwen3-30b-a3b`.
 */
export function modelShortName(model: string | undefined): string {
  if (!model) return 'qwen3';
  const last = model.split('/').pop() ?? model;
  return last.replace(/-(fp8|fp16|int8|int4|awq)$/i, '') || 'qwen3';
}

/** Candidates in ranking order (unranked candidates are left out). */
export function rankedCandidates(
  r: Pick<RecommendationDto, 'candidates' | 'ranking'>,
): Candidate[] {
  const byId = new Map(r.candidates.map(c => [c.id, c] as const));
  return r.ranking.map(id => byId.get(id)).filter((c): c is Candidate => !!c);
}

/** The candidate that confirmation executes (ranking[0]). */
export function topCandidate(r: {
  candidates?: Candidate[];
  ranking?: string[];
}): Candidate | undefined {
  if (!r.candidates?.length) return undefined;
  const id = r.ranking?.[0];
  return (
    r.candidates.find(c => c.id === id) ?? (id ? undefined : r.candidates[0])
  );
}

/** Whether a value looks like a RID (`ri.<Type>.<ulid>`). */
export function looksLikeRid(v: unknown): v is Rid {
  return typeof v === 'string' && typeOfRid(v) !== undefined;
}

/** Plain text of a non-reference parameter value. */
export function paramText(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/** Title of a RID found in the recommendation (targets / affected objects). */
export function titleForRid(
  r: Pick<RecommendationDto, 'candidates' | 'simulation'>,
  rid: string,
): string | undefined {
  return (
    r.candidates.find(c => c.target === rid)?.targetTitle ??
    r.simulation?.affected.find(a => a.rid === rid)?.title
  );
}

// --- KPI comparison ----------------------------------------------------------

/** Relative change of `value` vs `base` (null when not computable). */
export function relDelta(
  base: number | undefined,
  value: number | undefined,
): number | null {
  if (
    base === undefined ||
    value === undefined ||
    !Number.isFinite(base) ||
    !Number.isFinite(value)
  )
    return null;
  if (base === 0) return value === 0 ? 0 : null;
  return (value - base) / Math.abs(base);
}

/** Whether a KPI change is good, bad or flat given `higherIsBetter`. */
export function kpiTrend(
  meta: Pick<KpiMeta, 'higherIsBetter'>,
  from: number | undefined,
  to: number | undefined,
): 'good' | 'bad' | 'flat' {
  if (from === undefined || to === undefined) return 'flat';
  const d = to - from;
  if (!Number.isFinite(d) || Math.abs(d) < 1e-9) return 'flat';
  return d > 0 === meta.higherIsBetter ? 'good' : 'bad';
}

/**
 * Candidate whose "scenario + actions" values are shown by default: the
 * highest expected impact among candidates with results, else the first
 * `withActions` key.
 */
export function bestCandidateId(
  result: Pick<ScenarioResult, 'withActions'>,
  candidates: readonly Candidate[],
): string | undefined {
  const w = result.withActions ?? {};
  const withResult = candidates.filter(c => w[c.id]);
  if (withResult.length)
    return [...withResult].sort(
      (a, b) => b.expectedImpact - a.expectedImpact,
    )[0].id;
  return Object.keys(w)[0];
}

/** Values of one KPI across the three columns. */
export interface KpiRow {
  meta: KpiMeta;
  baseline?: number;
  scenario?: number;
  withActions?: number;
}

/** KPI table rows (ontology order from `result.kpis`). */
export function kpiRows(
  result: ScenarioResult,
  withActions?: KpiSet,
): KpiRow[] {
  return result.kpis.map(meta => ({
    meta,
    baseline: result.baseline[meta.apiName],
    scenario: result.scenario[meta.apiName],
    withActions: withActions?.[meta.apiName],
  }));
}

// --- Impact graph ------------------------------------------------------------

/** Impact graph: affected objects sized/colored by normalized |delta|. */
export function impactGraph(
  result: Pick<ScenarioResult, 'affected'> | undefined,
  links?: {edges: readonly GraphEdge[]},
): {nodes: GNode[]; edges: GEdge[]; hops: number} {
  const affected = result?.affected ?? [];
  const max = Math.max(0, ...affected.map(a => Math.abs(a.delta)));
  const nodes: GNode[] = affected.map(a => ({
    id: a.rid,
    label: a.title,
    type: a.type,
    impact: max > 0 ? Math.abs(a.delta) / max : 0,
    hop: a.hop,
    root: a.hop === 0,
  }));
  const ids = new Set(nodes.map(n => n.id));
  const seen = new Set<string>();
  const edges: GEdge[] = [];
  for (const e of links?.edges ?? []) {
    if (!ids.has(e.src) || !ids.has(e.dst)) continue;
    const id = `${e.type}:${e.src}:${e.dst}`;
    if (seen.has(id)) continue;
    seen.add(id);
    edges.push({
      id,
      source: e.src,
      target: e.dst,
      type: e.type,
      weight: e.weight,
    });
  }
  const hops = Math.max(0, ...affected.map(a => a.hop));
  return {nodes, edges, hops};
}

// --- Scenario drafts ---------------------------------------------------------

/** Maximum perturbations per scenario. */
export const PERTURBATIONS_MAX = DECISION_LIMITS.perturbationsMax;
/** Maximum candidate actions per scenario (input schema). */
export const CANDIDATE_ACTIONS_MAX = 10;
/** Slider step (percent). */
export const CHANGE_STEP_PCT = 5;

/** An editable perturbation (change in percent −100..100). */
export interface PerturbationDraft {
  key: string;
  rid: string;
  property: string;
  changePct: number;
}

let draftSeq = 0;

/** New empty perturbation draft. */
export function newPerturbation(
  init: Partial<Omit<PerturbationDraft, 'key'>> = {},
): PerturbationDraft {
  draftSeq += 1;
  return {
    key: `p${draftSeq}`,
    rid: init.rid ?? '',
    property: init.property ?? '',
    changePct: clampPct(init.changePct ?? 0),
  };
}

/** Clamps and snaps a percent to −100..100 in steps of 5. */
export function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const snapped = Math.round(v / CHANGE_STEP_PCT) * CHANGE_STEP_PCT;
  return Math.max(-100, Math.min(100, snapped));
}

/** Whether another perturbation can be added. */
export function canAddPerturbation(list: readonly unknown[]): boolean {
  return list.length < PERTURBATIONS_MAX;
}

/** Whether a draft is complete (object and property chosen). */
export function isCompleteDraft(d: PerturbationDraft): boolean {
  return looksLikeRid(d.rid) && !!d.property;
}

/** A selectable candidate action (action type on a target object). */
export interface CandidateOption {
  key: string;
  actionType: string;
  displayName: string;
  target: string;
  targetTitle: string;
  action: UiActionType;
}

/** Key of a candidate option. */
export function candidateKey(a: {actionType: string; target: string}): string {
  return `${a.actionType}→${a.target}`;
}

/**
 * Candidate actions from the ontology: every action type whose target type
 * matches the type of a perturbed or impacted object.
 */
export function candidateOptions(
  model: Pick<UiModel, 'actions'>,
  objects: readonly {rid: string; title: string; type?: string}[],
): CandidateOption[] {
  const out: CandidateOption[] = [];
  const seen = new Set<string>();
  for (const o of objects) {
    const type = o.type ?? typeOfRid(o.rid);
    if (!type) continue;
    for (const a of model.actions) {
      if (a.targetType !== type) continue;
      const key = candidateKey({actionType: a.apiName, target: o.rid});
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        actionType: a.apiName,
        displayName: a.displayName,
        target: o.rid,
        targetTitle: o.title,
        action: a,
      });
    }
  }
  return out;
}

/** Initial parameter values of an action (ontology defaults). */
export function defaultParams(a: UiActionType): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of a.parameters)
    if (p.defaultValue !== undefined) out[p.apiName] = p.defaultValue;
  return out;
}

/** Selected candidate (key → parameters). */
export type CandidateSelection = Record<string, Record<string, unknown>>;

/** Builds the `POST /scenarios` body from the drafts and selections. */
export function toScenarioInput(
  drafts: readonly PerturbationDraft[],
  selection: CandidateSelection,
  options: readonly CandidateOption[],
  name?: string,
): ScenarioInput {
  const byKey = new Map(options.map(o => [o.key, o] as const));
  const candidateActions: CandidateActionInput[] = [];
  for (const [key, params] of Object.entries(selection)) {
    const o = byKey.get(key);
    if (!o) continue;
    const clean = Object.fromEntries(
      Object.entries(params).filter(
        ([, v]) => v !== undefined && v !== null && v !== '',
      ),
    );
    candidateActions.push({
      actionType: o.actionType,
      target: o.target as Rid,
      ...(Object.keys(clean).length ? {params: clean} : {}),
    });
  }
  return {
    ...(name ? {name} : {}),
    perturbations: drafts.filter(isCompleteDraft).map(d => ({
      rid: d.rid as Rid,
      property: d.property,
      change: clampPct(d.changePct) / 100,
    })),
    ...(candidateActions.length
      ? {candidateActions: candidateActions.slice(0, CANDIDATE_ACTIONS_MAX)}
      : {}),
  };
}

/**
 * Route id for `/<base>/$id` pages: the router param when registered, else
 * the path segment after `/<base>/` (catch-all routes in tests).
 */
export function routeId(
  params: {id?: unknown},
  pathname: string,
  base: string,
): string | undefined {
  if (typeof params.id === 'string' && params.id) return params.id;
  const m = new RegExp(`/${base}/([^/?#]+)`).exec(pathname);
  return m ? decodeURIComponent(m[1]) : undefined;
}
