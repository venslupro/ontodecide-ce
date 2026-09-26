/**
 * @fileoverview Scenario use cases: create, list, get, run (what-if) and
 * candidate listing.
 */

import {
  AppError,
  parseOrThrow,
  ulid,
  type CallCtx,
  type Rid,
} from '@ontodecide/shared-kernel';
import {
  runScenarioInputSchema,
  scenarioInputSchema,
  type CandidateAction,
  type Perturbation,
  type ScenarioDto,
  type ScenarioInput,
  type ScenarioResult,
} from '../contract';
import {normalizeLocale} from '../domain';
import type {DecisionDeps} from './deps';
import {Simulator, validatePerturbations, type SimContext} from './simulator';
import {requireTenantRid, toScenarioDto} from './support';

function ensureRootsLoaded(
  sc: SimContext,
  perturbations: Perturbation[],
): void {
  const present = new Set(sc.slice.nodes.map(n => n.rid));
  for (const p of perturbations) {
    if (!present.has(p.rid)) {
      throw new AppError('PERTURBATION_INVALID', `Object not found: ${p.rid}`);
    }
  }
}

/** Creates a scenario. */
export class CreateScenario {
  constructor(private readonly deps: DecisionDeps) {}

  async execute(ctx: CallCtx, input: ScenarioInput): Promise<ScenarioDto> {
    const perturbations = validatePerturbations(ctx, input?.perturbations);
    const parsed = parseOrThrow(scenarioInputSchema, {...input, perturbations});
    const now = this.deps.clock.now();
    const rec = {
      id: ulid(now.getTime()),
      tenantId: ctx.tenantId,
      name: parsed.name?.trim() || `Scenario ${now.toISOString().slice(0, 16)}`,
      perturbations,
      createdBy: ctx.userId,
      createdAt: now.toISOString(),
    };
    await this.deps.scenarios.insert(rec);
    return toScenarioDto(rec);
  }
}

/** Lists scenarios of the tenant (newest first). */
export class ListScenarios {
  constructor(private readonly deps: DecisionDeps) {}

  async execute(ctx: CallCtx): Promise<ScenarioDto[]> {
    return (await this.deps.scenarios.list(ctx.tenantId, 200)).map(
      toScenarioDto,
    );
  }
}

/** Gets one scenario. */
export class GetScenario {
  constructor(private readonly deps: DecisionDeps) {}

  async execute(ctx: CallCtx, id: string): Promise<ScenarioDto> {
    const s = await this.deps.scenarios.get(ctx.tenantId, String(id));
    if (!s) throw new AppError('NOT_FOUND', `Scenario ${id} not found`);
    return toScenarioDto(s);
  }
}

/** Runs a what-if simulation synchronously. */
export class RunScenario {
  constructor(
    private readonly deps: DecisionDeps,
    private readonly simulator: Simulator,
  ) {}

  async execute(
    ctx: CallCtx,
    input: ScenarioInput & {scenarioId?: string},
  ): Promise<ScenarioResult> {
    const stored = input?.scenarioId
      ? await this.deps.scenarios.get(ctx.tenantId, String(input.scenarioId))
      : null;
    if (input?.scenarioId && !stored) {
      throw new AppError('NOT_FOUND', `Scenario ${input.scenarioId} not found`);
    }
    const perturbations = validatePerturbations(
      ctx,
      input?.perturbations ?? stored?.perturbations,
    );
    const parsed = parseOrThrow(runScenarioInputSchema, {
      ...input,
      perturbations,
    });
    const actions = (parsed.candidateActions ?? []).map(a => ({
      actionType: a.actionType,
      target: requireTenantRid(ctx, a.target),
    }));
    const sc = await this.simulator.load(ctx, [
      ...perturbations.map(p => p.rid),
      ...actions.map(a => a.target),
    ]);
    ensureRootsLoaded(sc, perturbations);
    for (const a of actions) {
      if (!sc.model.actionTypes[a.actionType]) {
        throw new AppError(
          'VALIDATION_FAILED',
          `Unknown action type: ${a.actionType}`,
        );
      }
    }
    const {result} = this.simulator.run(sc, perturbations, actions);
    if (stored) {
      if (input.perturbations) {
        await this.deps.scenarios.setPerturbations(
          ctx.tenantId,
          stored.id,
          perturbations,
        );
      }
      await this.deps.scenarios.setResult(ctx.tenantId, stored.id, result);
    }
    return result;
  }
}

/** Candidate actions for the objects impacted by the perturbations. */
export class ListCandidateActions {
  constructor(private readonly simulator: Simulator) {}

  async execute(
    ctx: CallCtx,
    perturbationsInput: Perturbation[],
  ): Promise<CandidateAction[]> {
    const perturbations = validatePerturbations(ctx, perturbationsInput);
    const sc = await this.simulator.load(
      ctx,
      perturbations.map(p => p.rid),
    );
    ensureRootsLoaded(sc, perturbations);
    const sim = this.simulator.run(sc, perturbations);
    const {candidates} = await this.simulator.candidates(
      ctx,
      sc,
      sim,
      perturbations,
      perturbations[0].rid as Rid,
      normalizeLocale(ctx.locale),
    );
    // CandidateAction carries no score; order best first.
    return [...candidates]
      .sort(
        (a, b) =>
          Number(b.eligible) - Number(a.eligible) ||
          b.expectedImpact - a.expectedImpact,
      )
      .map(({expectedImpact: _x, ...c}) => c);
  }
}
