/**
 * @fileoverview DecisionRpc handler object: maps the contract onto the use
 * cases. Errors are AppErrors, which survive the RPC boundary.
 */

import type {DecisionRpc} from '../contract';
import {
  Decide,
  GenerateRecommendation,
  GetRecommendation,
  GetScenario,
  ListRecommendations,
  RecommendationUsage,
  RunScenario,
  type DecisionDeps,
} from '../application';

/** Builds the DecisionRpc implementation. */
export function createDecisionRpc(deps: DecisionDeps): DecisionRpc {
  const runScenario = new RunScenario(deps);
  const getScenario = new GetScenario(deps);
  const list = new ListRecommendations(deps);
  const get = new GetRecommendation(deps);
  const generate = new GenerateRecommendation(deps);
  const decide = new Decide(deps);
  const usage = new RecommendationUsage(deps);
  return {
    runScenario: (ctx, input) => runScenario.execute(ctx, input),
    getScenario: (ctx, id) => getScenario.execute(ctx, id),
    listRecommendations: (ctx, q, page) => list.execute(ctx, q, page),
    getRecommendation: (ctx, id) => get.execute(ctx, id),
    generateRecommendation: (ctx, input) => generate.execute(ctx, input),
    decide: (ctx, id, input, key) => decide.execute(ctx, id, input, key),
    usage: ctx => usage.execute(ctx),
  };
}
