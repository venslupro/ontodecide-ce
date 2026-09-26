/**
 * @fileoverview Candidate action generation. Action types whose target type
 * is among the affected object types (or the focus type) become candidates
 * for the most affected objects of that type. Parameters are prefilled from
 * defaults and `suggest` lookups; preconditions decide eligibility.
 */

import {evalLogic, resolveText, type Rid} from '@ontodecide/shared-kernel';
import type {GraphNode, GraphSlice} from '@ontodecide/object-graph/contract';
import type {
  ActionTypeDef,
  CompiledModel,
  ParamSuggestDef,
} from '@ontodecide/ontology/contract';
import type {CandidateAction} from '../contract';
import type {Impact} from './propagation';

/** Candidate limits. */
export const CANDIDATE_LIMITS = {
  /** Targets considered per action type. */
  perActionType: 3,
  /** Total candidates (matches the withActions limit of scenario input). */
  total: 10,
} as const;

/** One (action type, target) pair to turn into a candidate. */
export interface CandidateSlot {
  def: ActionTypeDef;
  target: GraphNode;
}

/**
 * Selects (action type, target) pairs: targets are affected objects of the
 * action's target type (largest |Δ| first), plus the focus.
 */
export function candidateSlots(
  model: CompiledModel,
  slice: GraphSlice,
  impact: Impact,
  focus: Rid,
): CandidateSlot[] {
  const nodes = new Map(slice.nodes.map(n => [n.rid, n]));
  const ranked = [...impact.delta]
    .filter(([rid, d]) => d !== 0 && nodes.has(rid))
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([rid]) => nodes.get(rid)!);
  const focusNode = nodes.get(focus);
  const slots: CandidateSlot[] = [];
  const actionTypes = Object.values(model.actionTypes).sort((a, b) =>
    a.apiName.localeCompare(b.apiName),
  );
  for (const def of actionTypes) {
    const targets: GraphNode[] = [];
    if (focusNode && focusNode.type === def.targetType) targets.push(focusNode);
    for (const n of ranked) {
      if (targets.length >= CANDIDATE_LIMITS.perActionType) break;
      if (n.type === def.targetType && !targets.includes(n)) targets.push(n);
    }
    for (const target of targets) slots.push({def, target});
  }
  return slots;
}

/** A parameter lookup the application must resolve via the object graph. */
export interface SuggestRequest {
  key: string;
  suggest: ParamSuggestDef;
  /** Objects of `suggest.objectType` to exclude (currently impacted ones). */
  exclude: Rid[];
}

/** Stable key of a suggest lookup. */
export function suggestKey(actionType: string, param: string): string {
  return `${actionType}.${param}`;
}

/** Suggest lookups needed for the slots (one per action parameter). */
export function suggestRequests(
  slots: readonly CandidateSlot[],
  slice: GraphSlice,
  impact: Impact,
): SuggestRequest[] {
  const out = new Map<string, SuggestRequest>();
  for (const {def} of slots) {
    for (const p of def.parameters) {
      if (!p.suggest) continue;
      const key = suggestKey(def.apiName, p.apiName);
      if (out.has(key)) continue;
      const exclude = slice.nodes
        .filter(
          n =>
            n.type === p.suggest!.objectType &&
            (impact.delta.get(n.rid) ?? 0) !== 0,
        )
        .map(n => n.rid);
      out.set(key, {key, suggest: p.suggest, exclude});
    }
  }
  return [...out.values()];
}

/** Resolved suggestions: key → ordered candidate rids. */
export type SuggestResults = Record<string, Rid[]>;

function evalPrecondition(
  expr: ActionTypeDef['preconditions'][number]['expr'],
  data: unknown,
): boolean {
  try {
    const v = evalLogic(expr, data);
    return Array.isArray(v) ? v.length > 0 : Boolean(v);
  } catch {
    return false;
  }
}

/** Builds a candidate for one slot. */
export function buildCandidate(
  slot: CandidateSlot,
  suggestions: SuggestResults,
  locale: string,
): CandidateAction {
  const {def, target} = slot;
  const params: Record<string, unknown> = {};
  const unmet: string[] = [];
  for (const p of def.parameters) {
    if (p.defaultValue !== undefined) params[p.apiName] = p.defaultValue;
    if (p.suggest) {
      const pick = (suggestions[suggestKey(def.apiName, p.apiName)] ?? []).find(
        rid => rid !== target.rid,
      );
      if (pick) params[p.apiName] = pick;
    }
    if (p.required && params[p.apiName] === undefined) {
      unmet.push(
        locale === 'en-US'
          ? `Missing parameter: ${resolveText(p.displayName, locale, p.apiName)}`
          : `缺少参数：${resolveText(p.displayName, locale, p.apiName)}`,
      );
    }
  }
  const data = {target: target.props, params};
  for (const pre of def.preconditions) {
    if (!evalPrecondition(pre.expr, data)) {
      unmet.push(resolveText(pre.message, locale, 'precondition'));
    }
  }
  return {
    actionType: def.apiName,
    displayName: def.displayName,
    target: target.rid,
    targetTitle: target.title,
    params,
    requiresApproval: def.requiresApproval,
    eligible: unmet.length === 0,
    ...(unmet.length ? {unmetPreconditions: unmet} : {}),
  };
}

/** Builds candidates for every slot, capped at {@link CANDIDATE_LIMITS}. */
export function buildCandidates(
  slots: readonly CandidateSlot[],
  suggestions: SuggestResults,
  locale: string,
): CandidateAction[] {
  return slots
    .slice(0, CANDIDATE_LIMITS.total)
    .map(s => buildCandidate(s, suggestions, locale));
}

/** A candidate together with its simulated benefit. */
export interface ScoredCandidate extends CandidateAction {
  expectedImpact: number;
}

/** Eligible candidates, best expected impact first. */
export function rankCandidates(
  candidates: readonly ScoredCandidate[],
): ScoredCandidate[] {
  return candidates
    .filter(c => c.eligible)
    .sort(
      (a, b) =>
        b.expectedImpact - a.expectedImpact ||
        a.actionType.localeCompare(b.actionType) ||
        a.target.localeCompare(b.target),
    );
}
