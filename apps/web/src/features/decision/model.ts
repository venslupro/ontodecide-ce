/**
 * @fileoverview Pure view-model helpers for the decision module: action keys,
 * status → badge level mapping, KPI deltas and impact-graph construction.
 * Every number shown comes from the simulator — these helpers only derive
 * presentation values (relative deltas, normalized intensities).
 */

import type {
  CandidateAction,
  KpiMeta,
  Perturbation,
  RecStatus,
  RecommendationDto,
  RecommendedAction,
  ScenarioResult,
} from '@ontodecide/decision/contract';
import type {GraphEdge} from '@ontodecide/object-graph/contract';
import type {StatusLevel} from '../../shared/ui/badge';
import type {GEdge, GNode} from '../../shared/graph/limit';

/** Key of a candidate / recommended action in `ScenarioResult.withActions`. */
export function actionKey(a: {actionType: string; target: string}): string {
  return `${a.actionType}:${a.target}`;
}

/** Splits an action key back into its parts (target RIDs contain dots, not colons). */
export function parseActionKey(key: string): {
  actionType: string;
  target: string;
} {
  const i = key.indexOf(':');
  return i < 0
    ? {actionType: key, target: ''}
    : {actionType: key.slice(0, i), target: key.slice(i + 1)};
}

/** Status filter tabs of the recommendation center, in display order. */
export const REC_FILTERS = [
  'Proposed',
  'Approved',
  'Executed',
  'Evaluated',
  'Rejected',
  'Expired',
  'All',
] as const;

/** One status filter tab. */
export type RecFilterTab = (typeof REC_FILTERS)[number];

/** Normalizes a `?status=` search value to a filter tab (default `Proposed`). */
export function toRecFilter(v: string | undefined): RecFilterTab {
  return (REC_FILTERS as readonly string[]).includes(v ?? '')
    ? (v as RecFilterTab)
    : 'Proposed';
}

/** Badge level of a recommendation status (always rendered with icon + text). */
export function recStatusLevel(s: RecStatus): StatusLevel {
  switch (s) {
    case 'Executed':
    case 'Evaluated':
      return 'good';
    case 'Proposed':
      return 'warn';
    case 'Rejected':
    case 'ExecFailed':
    case 'Failed':
      return 'crit';
    default:
      return 'info';
  }
}

/** Badge level of a simulation risk level. */
export function riskLevelStatus(
  level: ScenarioResult['riskLevel'],
): StatusLevel {
  return level === 'HIGH' ? 'crit' : level === 'MEDIUM' ? 'warn' : 'good';
}

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
  delta: number | null,
): 'good' | 'bad' | 'flat' {
  if (delta === null || Math.abs(delta) < 1e-9) return 'flat';
  return delta > 0 === meta.higherIsBetter ? 'good' : 'bad';
}

/** The top-ranked recommended action (lowest rank). */
export function topAction(
  rec: Pick<RecommendationDto, 'actions'>,
): RecommendedAction | undefined {
  return [...rec.actions].sort((a, b) => a.rank - b.rank)[0];
}

/** Whether a string looks like a RID. */
export function looksLikeRid(v: unknown): v is string {
  return typeof v === 'string' && /^ri\.[^.]+\.[^.]+\.[^.]+$/.test(v);
}

/** Compact, language-neutral params summary for non-reference values. */
export function paramText(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Short display form of a RID: `Type·…last6`. */
export function shortRid(rid: string): string {
  const p = rid.split('.');
  return p.length === 4 ? `${p[2]}·${p[3].slice(-6)}` : rid;
}

/** Normalized impact heat graph built from a simulation result and an impact slice. */
export function buildImpactGraph(
  affected: ScenarioResult['affected'],
  edges: readonly GraphEdge[] | undefined,
  roots: readonly string[],
): {nodes: GNode[]; edges: GEdge[]} {
  const max = affected.reduce((m, a) => Math.max(m, Math.abs(a.delta)), 0) || 1;
  const ids = new Set(affected.map(a => a.rid as string));
  const rootSet = new Set(roots);
  const nodes: GNode[] = affected.map(a => ({
    id: a.rid,
    label: a.title,
    type: a.type,
    impact: Math.abs(a.delta) / max,
    hop: a.hop,
    root: rootSet.has(a.rid),
  }));
  const seen = new Set<string>();
  const out: GEdge[] = [];
  for (const e of edges ?? []) {
    if (!ids.has(e.src) || !ids.has(e.dst)) continue;
    const id = `${e.type}:${e.src}>${e.dst}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      source: e.src,
      target: e.dst,
      type: e.type,
      weight: e.weight ?? null,
    });
  }
  return {nodes, edges: out};
}

/** Affected objects ranked by |delta| desc, then hop asc. */
export function rankAffected(
  affected: ScenarioResult['affected'],
): ScenarioResult['affected'] {
  return [...affected].sort(
    (a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.hop - b.hop,
  );
}

/** Editable perturbation row (change may be temporarily invalid while typing). */
export interface PerturbationDraft {
  key: string;
  rid: string;
  property: string;
  /** Relative change −1..1. */
  change: number;
}

let draftSeq = 0;

/** Creates an empty perturbation row. */
export function newPerturbationDraft(
  init: Partial<Omit<PerturbationDraft, 'key'>> = {},
): PerturbationDraft {
  draftSeq += 1;
  return {
    key: `p${draftSeq}`,
    rid: init.rid ?? '',
    property: init.property ?? '',
    change: init.change ?? 0,
  };
}

/** Rows that are complete enough to ask for candidates / run. */
export function completePerturbations(
  rows: readonly PerturbationDraft[],
): Perturbation[] {
  return rows
    .filter(
      r =>
        looksLikeRid(r.rid) &&
        r.property &&
        Number.isFinite(r.change) &&
        Math.abs(r.change) <= 1,
    )
    .map(r => ({
      rid: r.rid as Perturbation['rid'],
      property: r.property,
      change: r.change,
    }));
}

/** Rounds a relative change to the slider step (5 %). */
export function snapChange(v: number): number {
  const c = Math.max(-1, Math.min(1, v));
  return Math.round(c * 20) / 20;
}

/** Candidate display lookup by action key. */
export function candidateByKey(
  cands: readonly CandidateAction[] | undefined,
): Map<string, CandidateAction> {
  return new Map((cands ?? []).map(c => [actionKey(c), c] as const));
}
