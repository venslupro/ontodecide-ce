/**
 * @fileoverview Simulation service shared by runScenario and
 * generateRecommendation: loads the compiled ontology and the impact
 * subgraph, runs the deterministic simulator and builds candidates
 * (resolving parameter suggestions through object-graph).
 */

import {AppError, type CallCtx, type Rid} from '@ontodecide/shared-kernel';
import type {GraphSlice} from '@ontodecide/object-graph/contract';
import type {
  ActionTypeDef,
  CompiledSchema,
  ParamSuggestDef,
} from '@ontodecide/ontology/contract';
import {
  DECISION_LIMITS,
  type CandidateActionInput,
  type Perturbation,
} from '../contract';
import {
  candidateSlots,
  numberCandidates,
  pickSuggestion,
  preconditionsMet,
  prefillParams,
  propagatingLinkTypes,
  scoreCandidate,
  selectCandidates,
  simulate,
  type ObjectLike,
  type ScoredCandidate,
  type SelectedCandidates,
  type Simulation,
  type Suggestions,
} from '../domain';
import type {DecisionDeps} from './ports';

/** Ontology and subgraph a simulation runs on. */
export interface SimContext {
  schema: CompiledSchema;
  slice: GraphSlice;
}

/** Pool size requested for suggestion lookups without a shared link. */
const SUGGEST_POOL = 100;

/** Simulation service. */
export class Simulator {
  constructor(private readonly deps: DecisionDeps) {}

  /** Loads the compiled ontology and the depth-2 impact subgraph (≤ 300). */
  async load(ctx: CallCtx, roots: readonly Rid[]): Promise<SimContext> {
    const schema = await this.deps.ontology.getCompiledSchema(ctx);
    const slice = await this.deps.objects.impactSubgraph(ctx, {
      rids: [...new Set(roots)],
      linkTypes: propagatingLinkTypes(schema.linkTypes),
      depth: DECISION_LIMITS.maxHops,
      limit: DECISION_LIMITS.subgraphNodesMax,
    });
    const nodes = slice.nodes.slice(0, DECISION_LIMITS.subgraphNodesMax);
    const keep = new Set(nodes.map(n => n.rid));
    return {
      schema,
      slice: {
        nodes,
        edges: slice.edges.filter(e => keep.has(e.src) && keep.has(e.dst)),
        truncated: slice.truncated || nodes.length < slice.nodes.length,
      },
    };
  }

  /** NOT_FOUND unless every rid is a node of the subgraph (same workspace). */
  requireNodes(sc: SimContext, rids: readonly Rid[]): void {
    const have = new Set(sc.slice.nodes.map(n => n.rid));
    for (const rid of rids) {
      if (!have.has(rid))
        throw new AppError('NOT_FOUND', `Object ${rid} not found`);
    }
  }

  /** Baseline and scenario. */
  simulate(sc: SimContext, perturbations: readonly Perturbation[]): Simulation {
    return simulate(sc.schema, sc.slice, perturbations);
  }

  /**
   * Deterministic candidates: eligible (params complete, preconditions
   * met) action/target pairs, scored and cut to the best three (c1..c3).
   */
  async deterministic(
    ctx: CallCtx,
    sc: SimContext,
    perturbations: readonly Perturbation[],
    sim: Simulation,
    focus?: Rid,
  ): Promise<SelectedCandidates> {
    const slots = candidateSlots(
      sc.schema.actionTypes,
      sc.slice.nodes,
      sim.impact,
      focus,
    );
    const exclude = this.excluded(sc, perturbations, sim);
    const lookups = new Map<string, Promise<ObjectLike[]>>();
    const scored: ScoredCandidate[] = [];
    for (const slot of slots) {
      const suggestions = await this.suggestions(
        ctx,
        slot.def,
        slot.target,
        exclude,
        lookups,
      );
      const {params, missing} = prefillParams(slot.def, suggestions);
      if (missing.length) continue;
      if (!preconditionsMet(slot.def, slot.target.props, params)) continue;
      scored.push(
        scoreCandidate(sc.schema, sc.slice, perturbations, sim, slot, params),
      );
    }
    return selectCandidates(scored);
  }

  /**
   * Candidates requested in a scenario (≤ 10, ids in input order). Missing
   * parameters are prefilled by the same rules; given ones are kept.
   */
  async requested(
    ctx: CallCtx,
    sc: SimContext,
    perturbations: readonly Perturbation[],
    sim: Simulation,
    inputs: readonly CandidateActionInput[],
  ): Promise<SelectedCandidates> {
    const exclude = this.excluded(sc, perturbations, sim);
    const lookups = new Map<string, Promise<ObjectLike[]>>();
    const scored: ScoredCandidate[] = [];
    for (const input of inputs) {
      const def = sc.schema.actionTypes[input.actionType];
      if (!def) {
        throw new AppError(
          'VALIDATION_FAILED',
          `Unknown action type ${input.actionType}`,
        );
      }
      const target = sc.slice.nodes.find(n => n.rid === input.target);
      if (!target) {
        throw new AppError('NOT_FOUND', `Object ${input.target} not found`);
      }
      if (target.type !== def.targetType) {
        throw new AppError(
          'VALIDATION_FAILED',
          `${input.actionType} does not apply to ${target.type}`,
        );
      }
      const suggestions = await this.suggestions(
        ctx,
        def,
        target,
        exclude,
        lookups,
      );
      const {params} = prefillParams(def, suggestions);
      Object.assign(params, input.params ?? {});
      scored.push(
        scoreCandidate(
          sc.schema,
          sc.slice,
          perturbations,
          sim,
          {def, target},
          params,
        ),
      );
    }
    return numberCandidates(scored);
  }

  /** Perturbation sources and negatively impacted objects. */
  private excluded(
    sc: SimContext,
    perturbations: readonly Perturbation[],
    sim: Simulation,
  ): Set<string> {
    const out = new Set<string>(perturbations.map(p => p.rid));
    for (const n of sc.slice.nodes) {
      if ((sim.impact.delta.get(n.rid) ?? 0) < 0) out.add(n.rid);
    }
    return out;
  }

  private async suggestions(
    ctx: CallCtx,
    def: ActionTypeDef,
    target: ObjectLike,
    exclude: ReadonlySet<string>,
    lookups: Map<string, Promise<ObjectLike[]>>,
  ): Promise<Suggestions> {
    const out: Suggestions = {};
    for (const p of def.parameters) {
      if (!p.suggest) continue;
      const pool = await this.pool(ctx, p.suggest, target.rid, lookups);
      out[p.apiName] = pickSuggestion(
        p.suggest,
        pool,
        new Set([...exclude, target.rid]),
      );
    }
    return out;
  }

  /** Objects a suggestion may pick from (memoized per call). */
  private pool(
    ctx: CallCtx,
    s: ParamSuggestDef,
    target: Rid,
    lookups: Map<string, Promise<ObjectLike[]>>,
  ): Promise<ObjectLike[]> {
    const shared = s.sharesLinkWithTarget;
    const key = shared
      ? `link|${target}|${shared.link}|${shared.direction}`
      : `type|${s.objectType}|${JSON.stringify(s.filter ?? null)}|${JSON.stringify(s.orderBy)}`;
    let p = lookups.get(key);
    if (!p) {
      p = shared
        ? this.deps.objects
            .getLinks(ctx, target, {
              depth: 1,
              linkTypes: [shared.link],
              direction: shared.direction,
              limit: DECISION_LIMITS.subgraphNodesMax,
            })
            .then(slice => slice.nodes)
        : this.deps.objects
            .listObjects(
              ctx,
              {
                type: s.objectType,
                ...(s.filter ? {filter: s.filter} : {}),
                orderBy: s.orderBy,
              },
              {limit: SUGGEST_POOL},
            )
            .then(page => page.items);
      lookups.set(key, p);
    }
    return p;
  }
}
