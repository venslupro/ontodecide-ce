/**
 * @fileoverview DecisionRpc implementation. Re-checks roles as defense in
 * depth (the gateway checks first) and normalizes thrown errors into
 * AppErrors so their codes survive the RPC boundary.
 */

import {AppError, type CallCtx, type Role} from '@ontodecide/shared-kernel';
import type {DecisionRpc} from '../contract';
import type {DecisionDeps} from '../application';
import {requireRole} from '../application';
import {createHandlers, type DecisionHandlers} from './handlers';

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw AppError.from(e);
  }
}

/** Builds the RPC object exposed by the WorkerEntrypoint. */
export function createDecisionRpc(
  deps: DecisionDeps,
  h: DecisionHandlers = createHandlers(deps),
): DecisionRpc {
  const as = <T>(ctx: CallCtx, role: Role, fn: (c: CallCtx) => Promise<T>) =>
    guarded(() => fn(requireRole(ctx, role)));
  return {
    listScenarios: ctx => as(ctx, 'Operator', c => h.listScenarios.execute(c)),
    createScenario: (ctx, input) =>
      as(ctx, 'Operator', c => h.createScenario.execute(c, input)),
    getScenario: (ctx, id) =>
      as(ctx, 'Operator', c => h.getScenario.execute(c, id)),
    runScenario: (ctx, input) =>
      as(ctx, 'Operator', c => h.runScenario.execute(c, input)),
    listCandidateActions: (ctx, perturbations) =>
      as(ctx, 'Operator', c =>
        h.listCandidateActions.execute(c, perturbations),
      ),
    generateRecommendation: (ctx, req) =>
      as(ctx, 'Operator', c => h.generateRecommendation.execute(c, req)),
    listRecommendations: (ctx, filter) =>
      as(ctx, 'Viewer', c => h.listRecommendations.execute(c, filter)),
    getRecommendation: (ctx, id) =>
      as(ctx, 'Viewer', c => h.getRecommendation.execute(c, id)),
    approve: (ctx, id) => as(ctx, 'Operator', c => h.approve.execute(c, id)),
    reject: (ctx, id, reason) =>
      as(ctx, 'Operator', c => h.reject.execute(c, id, reason)),
    feedback: (ctx, id, input) =>
      as(ctx, 'Operator', c => h.feedback.execute(c, id, input)),
    suggestMapping: (ctx, sample) =>
      as(ctx, 'Modeler', c => h.suggestMapping.execute(c, sample)),
    llmQuota: ctx => as(ctx, 'Viewer', c => h.llmQuota.execute(c)),
    evaluateOutcomes: now => guarded(() => h.evaluateOutcomes.execute(now)),
  };
}
