/**
 * @fileoverview Deterministic candidate actions (详细设计 6.11.5 候选动作).
 * Action types whose target type is an affected object type become
 * candidates for the most affected objects of that type (the focus first).
 * Parameters are prefilled by rules (defaults and {@link ParamSuggestDef}
 * lookups); preconditions (JSONLogic over `{target, params}`) decide
 * eligibility. Each candidate is re-simulated with its impact hints (or
 * numeric effects) to obtain its expected impact. Candidates, and their
 * parameters, never change afterwards — Workers AI only ranks their ids.
 */

import {evalLogic, matchFilter, type Rid} from '@ontodecide/shared-kernel';
import type {GraphNode, GraphSlice} from '@ontodecide/object-graph/contract';
import type {
  ActionTypeDef,
  ParamSuggestDef,
} from '@ontodecide/ontology/contract';
import {
  DECISION_LIMITS,
  type Candidate,
  type KpiSet,
  type Perturbation,
} from '../contract';
import {clamp, type Impact} from './propagation';
import {
  changedCount,
  expectedImpact,
  num,
  primaryKpi,
  round,
  simulateWith,
  type SimSchema,
  type Simulation,
} from './simulation';

/** Targets considered per action type. */
export const TARGETS_PER_ACTION_TYPE = 3;

/** An object a candidate can target or a parameter can reference. */
export interface ObjectLike {
  rid: Rid;
  type: string;
  title: string;
  props: Record<string, unknown>;
}

/** One (action type, target) pair to turn into a candidate. */
export interface CandidateSlot {
  def: ActionTypeDef;
  target: ObjectLike;
}

function byRid(a: {rid: string}, b: {rid: string}): number {
  return a.rid < b.rid ? -1 : a.rid > b.rid ? 1 : 0;
}

/**
 * Selects (action type, target) pairs: for each action type (by api name)
 * whose target type is affected, the focus (when of that type) and then the
 * most affected objects of that type (largest |Δ| first, then rid).
 */
export function candidateSlots(
  actionTypes: Record<string, ActionTypeDef>,
  nodes: readonly GraphNode[],
  impact: Impact,
  focus?: Rid,
): CandidateSlot[] {
  const affected = nodes
    .filter(n => (impact.delta.get(n.rid) ?? 0) !== 0)
    .sort(
      (a, b) =>
        Math.abs(impact.delta.get(b.rid)!) -
          Math.abs(impact.delta.get(a.rid)!) || byRid(a, b),
    );
  const focusNode = focus ? nodes.find(n => n.rid === focus) : undefined;
  const affectedTypes = new Set(affected.map(n => n.type));
  if (focusNode) affectedTypes.add(focusNode.type);
  const defs = Object.values(actionTypes)
    .filter(d => affectedTypes.has(d.targetType))
    .sort((a, b) => (a.apiName < b.apiName ? -1 : 1));
  const slots: CandidateSlot[] = [];
  for (const def of defs) {
    const targets: GraphNode[] = [];
    if (focusNode?.type === def.targetType) targets.push(focusNode);
    for (const n of affected) {
      if (targets.length >= TARGETS_PER_ACTION_TYPE) break;
      if (n.type === def.targetType && !targets.includes(n)) targets.push(n);
    }
    for (const target of targets) slots.push({def, target});
  }
  return slots;
}

function compareValues(a: unknown, b: unknown): number {
  const na = num(a);
  const nb = num(b);
  if (na !== null && nb !== null) return na - nb;
  if (a === undefined || a === null)
    return b === undefined || b === null ? 0 : 1;
  if (b === undefined || b === null) return -1;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/**
 * Picks the suggested object for a parameter from a pool: objects of the
 * suggested type matching the filter, not excluded, ordered by `orderBy`
 * (missing values last) and then rid. Deterministic for a given pool.
 */
export function pickSuggestion(
  suggest: ParamSuggestDef,
  pool: readonly ObjectLike[],
  exclude: ReadonlySet<string>,
): Rid | undefined {
  const {prop, dir} = suggest.orderBy;
  const sign = dir === 'desc' ? -1 : 1;
  const matches = pool
    .filter(
      o =>
        o.type === suggest.objectType &&
        !exclude.has(o.rid) &&
        matchFilter(suggest.filter, o.props),
    )
    .sort((a, b) => {
      const va = a.props[prop];
      const vb = b.props[prop];
      const missA = va === undefined || va === null;
      const missB = vb === undefined || vb === null;
      if (missA !== missB) return missA ? 1 : -1;
      return sign * compareValues(va, vb) || byRid(a, b);
    });
  return matches[0]?.rid;
}

/** Suggested values per parameter api name (resolved by the application). */
export type Suggestions = Record<string, Rid | undefined>;

/** Parameters prefilled for a slot, plus required ones left empty. */
export interface Prefill {
  params: Record<string, unknown>;
  missing: string[];
}

/** Prefills parameters from defaults and suggestions. */
export function prefillParams(
  def: ActionTypeDef,
  suggestions: Suggestions,
): Prefill {
  const params: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const p of def.parameters) {
    if (p.defaultValue !== undefined) params[p.apiName] = p.defaultValue;
    const s = suggestions[p.apiName];
    if (p.suggest && s !== undefined) params[p.apiName] = s;
    if (p.required && params[p.apiName] === undefined) missing.push(p.apiName);
  }
  return {params, missing};
}

function truthy(v: unknown): boolean {
  return Array.isArray(v) ? v.length > 0 : Boolean(v);
}

/** Whether every precondition holds for `{target, params}`. */
export function preconditionsMet(
  def: ActionTypeDef,
  targetProps: Record<string, unknown>,
  params: Record<string, unknown>,
): boolean {
  const data = {target: targetProps, params};
  for (const pre of def.preconditions) {
    try {
      if (!truthy(evalLogic(pre.expr, data))) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Relative changes an action causes on its target: its impact hints, or —
 * without hints — its numeric `set` / `increment` effects relative to the
 * current value. Relink / unlink effects have no numeric hint.
 */
export function actionHints(
  def: ActionTypeDef,
  target: ObjectLike,
  params: Record<string, unknown>,
): Perturbation[] {
  if (def.impact?.length) {
    return def.impact.map(h => ({
      rid: target.rid,
      property: h.property,
      change: clamp(h.change, -1, 1),
    }));
  }
  const data = {target: target.props, params};
  const out: Perturbation[] = [];
  for (const e of def.effects) {
    if (e.kind !== 'set' && e.kind !== 'increment') continue;
    const current = num(target.props[e.prop]);
    if (current === null || current === 0) continue;
    let value: number | null;
    try {
      value = num(evalLogic(e.kind === 'set' ? e.value : e.by, data));
    } catch {
      value = null;
    }
    if (value === null) continue;
    const change =
      e.kind === 'set'
        ? (value - current) / Math.abs(current)
        : value / Math.abs(current);
    if (change !== 0) {
      out.push({
        rid: target.rid,
        property: e.prop,
        change: round(clamp(change, -1, 1), 4),
      });
    }
  }
  return out;
}

/** A candidate before id assignment, with its with-action KPIs. */
export interface ScoredCandidate extends Omit<Candidate, 'id'> {
  withAction: KpiSet;
}

/** Scores a candidate by re-simulating the scenario with its hints. */
export function scoreCandidate(
  schema: SimSchema,
  slice: Pick<GraphSlice, 'nodes' | 'edges'>,
  base: readonly Perturbation[],
  sim: Simulation,
  slot: CandidateSlot,
  params: Record<string, unknown>,
): ScoredCandidate {
  const hints = actionHints(slot.def, slot.target, params);
  const w = simulateWith(schema, slice, base, hints);
  return {
    actionType: slot.def.apiName,
    displayName: slot.def.displayName,
    target: slot.target.rid,
    targetTitle: slot.target.title,
    params,
    expectedImpact: expectedImpact(
      primaryKpi(schema),
      sim.baseline,
      sim.scenario,
      w.kpis,
    ),
    affectedCount: changedCount(w.impact, sim.impact),
    withAction: w.kpis,
  };
}

/**
 * Rule order (详细设计 6.11.5 规则排序): expected impact desc → affected
 * count asc → action api name → target rid.
 */
export function compareByRules(
  a: Pick<
    Candidate,
    'expectedImpact' | 'affectedCount' | 'actionType' | 'target'
  >,
  b: Pick<
    Candidate,
    'expectedImpact' | 'affectedCount' | 'actionType' | 'target'
  >,
): number {
  return (
    b.expectedImpact - a.expectedImpact ||
    a.affectedCount - b.affectedCount ||
    (a.actionType < b.actionType ? -1 : a.actionType > b.actionType ? 1 : 0) ||
    (a.target < b.target ? -1 : a.target > b.target ? 1 : 0)
  );
}

/** Candidates with ids and their with-action KPIs keyed by id. */
export interface SelectedCandidates {
  candidates: Candidate[];
  withActions: Record<string, KpiSet>;
}

function withIds(list: readonly ScoredCandidate[]): SelectedCandidates {
  const candidates: Candidate[] = [];
  const withActions: Record<string, KpiSet> = {};
  list.forEach((c, i) => {
    const id = `c${i + 1}`;
    const {withAction, ...rest} = c;
    candidates.push({id, ...rest});
    withActions[id] = withAction;
  });
  return {candidates, withActions};
}

/**
 * Keeps the best `max` candidates in rule order and assigns ids c1..cN
 * (c1 is the rule-best candidate).
 */
export function selectCandidates(
  scored: readonly ScoredCandidate[],
  max: number = DECISION_LIMITS.candidatesMax,
): SelectedCandidates {
  return withIds([...scored].sort(compareByRules).slice(0, max));
}

/** Assigns ids c1..cN in input order (user-specified scenario actions). */
export function numberCandidates(
  scored: readonly ScoredCandidate[],
): SelectedCandidates {
  return withIds(scored);
}

/** Candidate ids in rule order. */
export function ruleRanking(candidates: readonly Candidate[]): string[] {
  return [...candidates].sort(compareByRules).map(c => c.id);
}
