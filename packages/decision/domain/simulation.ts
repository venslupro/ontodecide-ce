/**
 * @fileoverview Deterministic what-if simulation over an impact subgraph:
 * simulation KPIs (baseline / scenario / with-action), risk level, affected
 * objects and the relative benefit of candidate actions.
 */

import type {Rid} from '@ontodecide/shared-kernel';
import type {GraphSlice} from '@ontodecide/object-graph/contract';
import type {
  ActionTypeDef,
  CompiledModel,
  SimulationKpiDef,
} from '@ontodecide/ontology/contract';
import type {KpiMeta, KpiSet, Perturbation, ScenarioResult} from '../contract';
import {propagate, type Impact} from './propagation';

/** Δ at or below this marks a node as materially affected for `count`. */
export const COUNT_AFFECTED_THRESHOLD = -0.1;

/** Api name of the fallback KPI used when the model declares none. */
export const FALLBACK_KPI = 'unaffectedObjects';

const FALLBACK_KPI_DEF: SimulationKpiDef = {
  apiName: FALLBACK_KPI,
  displayName: {'zh-CN': '未受影响对象数', 'en-US': 'Unaffected objects'},
  objectType: '*',
  agg: 'count',
  higherIsBetter: true,
};

/** Simulation KPIs of a model; falls back to a count of unaffected objects. */
export function simulationKpis(model: CompiledModel): SimulationKpiDef[] {
  return model.simulationKpis?.length
    ? model.simulationKpis
    : [FALLBACK_KPI_DEF];
}

/** The primary KPI (first simulation KPI, else the fallback). */
export function primaryKpi(model: CompiledModel): SimulationKpiDef {
  return simulationKpis(model)[0];
}

/** KPI metadata for the result. */
export function kpiMeta(defs: readonly SimulationKpiDef[]): KpiMeta[] {
  return defs.map(d => ({
    apiName: d.apiName,
    displayName: d.displayName,
    ...(d.unit ? {unit: d.unit} : {}),
    higherIsBetter: d.higherIsBetter,
  }));
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))
    return Number(v);
  return null;
}

/**
 * Computes KPI values over the slice. `delta` absent (or empty) yields the
 * baseline. `sum` = Σ prop·(1+Δ); `avg` = mean of prop·(1+Δ) over nodes
 * with a numeric value; `count` = nodes of the type with Δ > −0.1.
 */
export function computeKpis(
  slice: GraphSlice,
  defs: readonly SimulationKpiDef[],
  delta: ReadonlyMap<Rid, number> = new Map(),
): KpiSet {
  const out: KpiSet = {};
  for (const def of defs) {
    const nodes =
      def.objectType === '*'
        ? slice.nodes
        : slice.nodes.filter(n => n.type === def.objectType);
    if (def.agg === 'count') {
      out[def.apiName] = nodes.filter(
        n => (delta.get(n.rid) ?? 0) > COUNT_AFFECTED_THRESHOLD,
      ).length;
      continue;
    }
    let sum = 0;
    let n = 0;
    for (const node of nodes) {
      const v = def.property ? num(node.props[def.property]) : null;
      if (v === null) continue;
      sum += v * (1 + (delta.get(node.rid) ?? 0));
      n++;
    }
    out[def.apiName] = round(def.agg === 'avg' ? (n ? sum / n : 0) : sum);
  }
  return out;
}

/** Rounds to 6 decimals to keep stored numbers stable. */
export function round(v: number, digits = 6): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/** Risk level from the maximum absolute Δ. */
export function riskLevel(
  deltas: Iterable<number>,
): ScenarioResult['riskLevel'] {
  let max = 0;
  for (const d of deltas) max = Math.max(max, Math.abs(d));
  if (max >= 0.3) return 'HIGH';
  if (max >= 0.1) return 'MEDIUM';
  return 'LOW';
}

/** Affected objects (Δ ≠ 0), largest |Δ| first. */
export function affectedList(
  slice: GraphSlice,
  impact: Impact,
): ScenarioResult['affected'] {
  const byRid = new Map(slice.nodes.map(n => [n.rid, n]));
  const out: ScenarioResult['affected'] = [];
  for (const [rid, d] of impact.delta) {
    if (d === 0) continue;
    const node = byRid.get(rid);
    out.push({
      rid,
      type: node?.type ?? rid.split('.')[2] ?? '',
      title: node?.title ?? rid,
      delta: round(d),
      hop: impact.hop.get(rid) ?? 0,
    });
  }
  return out.sort(
    (a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.hop - b.hop,
  );
}

/** A concrete action to simulate. */
export interface SimAction {
  actionType: string;
  target: Rid;
}

/** Key of a with-action KPI set. */
export function actionKey(a: SimAction): string {
  return `${a.actionType}:${a.target}`;
}

/** Base perturbations plus the action's impact hints applied to its target. */
export function actionPerturbations(
  base: readonly Perturbation[],
  def: Pick<ActionTypeDef, 'impact'>,
  target: Rid,
): Perturbation[] {
  return [
    ...base,
    ...(def.impact ?? []).map(h => ({
      rid: target,
      property: h.property,
      change: h.change,
    })),
  ];
}

/**
 * Relative improvement of the primary KPI brought by an action:
 * (withAction − scenario) / max(|baseline|, 1e-9), sign-flipped when lower
 * is better.
 */
export function expectedImpact(
  primary: Pick<SimulationKpiDef, 'apiName' | 'higherIsBetter'>,
  baseline: KpiSet,
  scenario: KpiSet,
  withAction: KpiSet,
): number {
  const k = primary.apiName;
  const denom = Math.max(Math.abs(baseline[k] ?? 0), 1e-9);
  const raw = ((withAction[k] ?? 0) - (scenario[k] ?? 0)) / denom;
  return round(primary.higherIsBetter ? raw : -raw, 4);
}

/** Everything the simulator derives from one slice and perturbation set. */
export interface Simulation {
  impact: Impact;
  result: ScenarioResult;
}

/** Input of {@link simulate}. */
export interface SimulateInput {
  model: CompiledModel;
  slice: GraphSlice;
  perturbations: readonly Perturbation[];
  actions?: readonly SimAction[];
  degraded?: boolean;
  now: Date;
}

/** Runs baseline, scenario and with-action simulations. */
export function simulate(input: SimulateInput): Simulation {
  const {model, slice, perturbations} = input;
  const defs = simulationKpis(model);
  const impact = propagate(slice, model.linkTypes, perturbations);
  const baseline = computeKpis(slice, defs);
  const scenario = computeKpis(slice, defs, impact.delta);
  const result: ScenarioResult = {
    baseline,
    scenario,
    affected: affectedList(slice, impact),
    riskLevel: riskLevel(impact.delta.values()),
    kpis: kpiMeta(defs),
    nodeCount: slice.nodes.length,
    degraded: input.degraded ?? false,
    computedAt: input.now.toISOString(),
  };
  if (input.actions?.length) {
    result.withActions = {};
    for (const a of input.actions) {
      const def = model.actionTypes[a.actionType];
      if (!def) continue;
      const p = propagate(
        slice,
        model.linkTypes,
        actionPerturbations(perturbations, def, a.target),
      );
      result.withActions[actionKey(a)] = computeKpis(slice, defs, p.delta);
    }
  }
  return {impact, result};
}
