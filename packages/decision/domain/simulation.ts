/**
 * @fileoverview Deterministic what-if simulation over an impact subgraph:
 * simulation KPIs from the ontology (sum / avg / count), the risk level,
 * affected objects and the benefit of a candidate action.
 */

import type {Rid} from '@ontodecide/shared-kernel';
import type {GraphSlice} from '@ontodecide/object-graph/contract';
import type {
  CompiledSchema,
  SimulationKpiDef,
} from '@ontodecide/ontology/contract';
import {
  DECISION_LIMITS,
  type KpiMeta,
  type KpiSet,
  type Perturbation,
  type ScenarioResult,
} from '../contract';
import {propagate, type Impact} from './propagation';

/** The ontology parts the simulator reads. */
export type SimSchema = Pick<
  CompiledSchema,
  'linkTypes' | 'simulationKpis' | 'objectTypes' | 'actionTypes'
>;

/** Δ at or below this marks a node as materially affected for `count`. */
export const COUNT_AFFECTED_THRESHOLD = -0.1;

/** Api name of the fallback KPI used when the ontology declares none. */
export const FALLBACK_KPI = 'unaffectedObjects';

const FALLBACK_KPI_DEF: SimulationKpiDef = {
  apiName: FALLBACK_KPI,
  displayName: {'zh-CN': '未受影响对象数', 'en-US': 'Unaffected objects'},
  objectType: '*',
  agg: 'count',
  higherIsBetter: true,
};

/** Simulation KPIs of a schema; falls back to a count of unaffected objects. */
export function simulationKpis(
  schema: Pick<SimSchema, 'simulationKpis'>,
): SimulationKpiDef[] {
  return schema.simulationKpis?.length
    ? schema.simulationKpis
    : [FALLBACK_KPI_DEF];
}

/** The primary KPI (the first simulation KPI, else the fallback). */
export function primaryKpi(
  schema: Pick<SimSchema, 'simulationKpis'>,
): SimulationKpiDef {
  return simulationKpis(schema)[0];
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

/** Numeric value of a property (numbers and numeric strings), else null. */
export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))
    return Number(v);
  return null;
}

/** Rounds to `digits` decimals to keep stored numbers stable. */
export function round(v: number, digits = 6): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/**
 * Computes KPI values over the slice. An empty `delta` yields the baseline.
 * `sum` = Σ prop·(1+Δ); `avg` = mean of prop·(1+Δ) over nodes with a numeric
 * value; `count` = nodes of the type with Δ > −0.1.
 */
export function computeKpis(
  slice: Pick<GraphSlice, 'nodes'>,
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

/** Risk level from the largest |Δ|: ≥ 0.3 HIGH, ≥ 0.1 MEDIUM, else LOW. */
export function riskLevel(
  deltas: Iterable<number>,
): ScenarioResult['riskLevel'] {
  let max = 0;
  for (const d of deltas) max = Math.max(max, Math.abs(d));
  if (max >= 0.3) return 'HIGH';
  if (max >= 0.1) return 'MEDIUM';
  return 'LOW';
}

/** Affected objects (Δ ≠ 0), largest |Δ| first, then hop, then rid. */
export function affectedList(
  slice: Pick<GraphSlice, 'nodes'>,
  impact: Impact,
): ScenarioResult['affected'] {
  const byRid = new Map(slice.nodes.map(n => [n.rid, n]));
  const out: ScenarioResult['affected'] = [];
  for (const [rid, d] of impact.delta) {
    if (d === 0) continue;
    const node = byRid.get(rid);
    out.push({
      rid,
      type: node?.type ?? rid.split('.')[1] ?? '',
      title: node?.title ?? rid,
      delta: round(d),
      hop: impact.hop.get(rid) ?? 0,
    });
  }
  return out.sort(
    (a, b) =>
      Math.abs(b.delta) - Math.abs(a.delta) ||
      a.hop - b.hop ||
      (a.rid < b.rid ? -1 : a.rid > b.rid ? 1 : 0),
  );
}

/**
 * Relative improvement of the primary KPI brought by an action:
 * (withAction − scenario) / max(|baseline|, 1e-9), sign-flipped when lower
 * is better. Rounded to 4 decimals.
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
  const v = round(primary.higherIsBetter ? raw : -raw, 4);
  return v === 0 ? 0 : v;
}

/** Objects whose Δ differs between two impacts by at least the prune bound. */
export function changedCount(a: Impact, b: Impact): number {
  const rids = new Set<Rid>([...a.delta.keys(), ...b.delta.keys()]);
  let n = 0;
  for (const rid of rids) {
    const diff = (a.delta.get(rid) ?? 0) - (b.delta.get(rid) ?? 0);
    if (Math.abs(diff) >= DECISION_LIMITS.pruneBelow) n++;
  }
  return n;
}

/** Baseline and scenario simulation of one perturbation set. */
export interface Simulation {
  impact: Impact;
  baseline: KpiSet;
  scenario: KpiSet;
  kpis: SimulationKpiDef[];
}

/** Runs the baseline and scenario simulation. */
export function simulate(
  schema: SimSchema,
  slice: Pick<GraphSlice, 'nodes' | 'edges'>,
  perturbations: readonly Perturbation[],
): Simulation {
  const kpis = simulationKpis(schema);
  const impact = propagate(slice, schema.linkTypes, perturbations);
  return {
    impact,
    baseline: computeKpis(slice, kpis),
    scenario: computeKpis(slice, kpis, impact.delta),
    kpis,
  };
}

/** Outcome of re-simulating with extra (action) perturbations. */
export interface ActionSimulation {
  kpis: KpiSet;
  impact: Impact;
}

/** Re-simulates the scenario with extra perturbations appended. */
export function simulateWith(
  schema: SimSchema,
  slice: Pick<GraphSlice, 'nodes' | 'edges'>,
  base: readonly Perturbation[],
  extra: readonly Perturbation[],
): ActionSimulation {
  const impact = propagate(slice, schema.linkTypes, [...base, ...extra]);
  return {
    impact,
    kpis: computeKpis(slice, simulationKpis(schema), impact.delta),
  };
}

/** Assembles the stored {@link ScenarioResult}. */
export function scenarioResult(
  slice: Pick<GraphSlice, 'nodes'>,
  sim: Simulation,
  withActions: Record<string, KpiSet> | undefined,
  now: Date,
): ScenarioResult {
  return {
    baseline: sim.baseline,
    scenario: sim.scenario,
    ...(withActions && Object.keys(withActions).length ? {withActions} : {}),
    affected: affectedList(slice, sim.impact),
    riskLevel: riskLevel(sim.impact.delta.values()),
    kpis: kpiMeta(sim.kpis),
    nodeCount: slice.nodes.length,
    computedAt: now.toISOString(),
  };
}
