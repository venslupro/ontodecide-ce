/**
 * @fileoverview Simulation service shared by scenario runs, candidate
 * listing, recommendation jobs and outcome evaluation: loads the model and
 * the impact subgraph, runs the deterministic simulator and scores
 * candidate actions.
 */

import {
  AppError,
  parseRid,
  type CallCtx,
  type Clock,
  type Rid,
} from '@ontodecide/shared-kernel';
import type {GraphSlice} from '@ontodecide/object-graph/contract';
import type {CompiledModel} from '@ontodecide/ontology/contract';
import {DECISION_LIMITS, type KpiSet, type Perturbation} from '../contract';
import {
  actionKey,
  buildCandidates,
  candidateSlots,
  expectedImpact,
  primaryKpi,
  propagatingLinkTypes,
  simulate,
  suggestRequests,
  type ScoredCandidate,
  type SimAction,
  type Simulation,
  type SuggestResults,
} from '../domain';
import type {GraphPort, ModelPort} from './ports';

/** Model and subgraph a simulation runs on. */
export interface SimContext {
  model: CompiledModel;
  slice: GraphSlice;
  degraded: boolean;
}

/** Checks count, range and tenant of perturbations. */
export function validatePerturbations(
  ctx: CallCtx,
  perturbations: readonly Perturbation[] | undefined,
): Perturbation[] {
  if (
    !Array.isArray(perturbations) ||
    perturbations.length === 0 ||
    perturbations.length > DECISION_LIMITS.perturbationsMax
  ) {
    throw new AppError(
      'PERTURBATION_INVALID',
      `1–${DECISION_LIMITS.perturbationsMax} perturbations are required`,
    );
  }
  for (const p of perturbations) {
    const parts = typeof p?.rid === 'string' ? parseRid(p.rid) : null;
    if (!parts || parts.tenantId !== ctx.tenantId) {
      throw new AppError(
        'PERTURBATION_INVALID',
        `Invalid rid: ${String(p?.rid)}`,
      );
    }
    if (typeof p.property !== 'string' || !p.property) {
      throw new AppError('PERTURBATION_INVALID', 'property is required');
    }
    if (typeof p.change !== 'number' || !(p.change >= -1 && p.change <= 1)) {
      throw new AppError('PERTURBATION_INVALID', 'change must be within −1..1');
    }
  }
  return perturbations.map(p => ({
    rid: p.rid,
    property: p.property,
    change: p.change,
  }));
}

/** Simulation service. */
export class Simulator {
  constructor(
    private readonly graph: GraphPort,
    private readonly models: ModelPort,
    private readonly clock: Clock,
  ) {}

  /** Loads the active model and the ≤ 3-hop impact subgraph of the roots. */
  async load(ctx: CallCtx, roots: readonly Rid[]): Promise<SimContext> {
    const model = await this.models.getActiveModel(ctx);
    const slice = await this.graph.impactSubgraph(ctx, {
      rids: [...new Set(roots)],
      linkTypes: propagatingLinkTypes(model.linkTypes),
      maxHops: DECISION_LIMITS.maxHops,
      limit: DECISION_LIMITS.subgraphNodesMax,
    });
    if (slice.nodes.length > DECISION_LIMITS.subgraphNodesMax) {
      throw new AppError(
        'GRAPH_TOO_LARGE',
        `Impact subgraph exceeds ${DECISION_LIMITS.subgraphNodesMax} nodes`,
      );
    }
    return {
      model,
      slice: {nodes: slice.nodes, edges: slice.edges},
      degraded: Boolean(slice.degraded),
    };
  }

  /** Runs the simulator on a loaded context. */
  run(
    sc: SimContext,
    perturbations: readonly Perturbation[],
    actions?: readonly SimAction[],
  ): Simulation {
    return simulate({
      model: sc.model,
      slice: sc.slice,
      perturbations,
      actions,
      degraded: sc.degraded,
      now: this.clock.now(),
    });
  }

  /**
   * Builds candidates for the affected objects and the focus, resolves
   * `suggest` parameters through the object graph and scores each candidate
   * by re-simulating with its impact hints.
   */
  async candidates(
    ctx: CallCtx,
    sc: SimContext,
    sim: Simulation,
    perturbations: readonly Perturbation[],
    focus: Rid,
    locale: string,
  ): Promise<{
    candidates: ScoredCandidate[];
    withActions: Record<string, KpiSet>;
  }> {
    const slots = candidateSlots(sc.model, sc.slice, sim.impact, focus);
    const suggestions: SuggestResults = {};
    for (const req of suggestRequests(slots, sc.slice, sim.impact)) {
      const exclude = new Set<string>(req.exclude);
      const page = await this.graph.evaluateObjectSet(
        ctx,
        {
          objectType: req.suggest.objectType,
          ...(req.suggest.filter ? {filter: req.suggest.filter} : {}),
          orderBy: [req.suggest.orderBy],
        },
        {limit: Math.min(200, exclude.size + 10)},
      );
      suggestions[req.key] = page.items
        .map(o => o.rid)
        .filter(r => !exclude.has(r));
    }
    const cands = buildCandidates(slots, suggestions, locale);
    const scored = this.run(sc, perturbations, cands);
    const withActions = scored.result.withActions ?? {};
    const primary = primaryKpi(sc.model);
    return {
      candidates: cands.map(c => ({
        ...c,
        expectedImpact: expectedImpact(
          primary,
          scored.result.baseline,
          scored.result.scenario,
          withActions[actionKey(c)] ?? scored.result.scenario,
        ),
      })),
      withActions,
    };
  }
}
