/**
 * @fileoverview Scenario use cases: runScenario (validate → simulate
 * baseline / scenario / with each candidate → store) and getScenario.
 */

import {
  AppError,
  parseOrThrow,
  ulid,
  type CallCtx,
  type Rid,
} from '@ontodecide/shared-kernel';
import {
  scenarioInputSchema,
  type ScenarioDto,
  type ScenarioInput,
} from '../contract';
import {scenarioResult} from '../domain';
import type {DecisionDeps} from './ports';
import {Simulator} from './simulator';

/** POST /scenarios. */
export class RunScenario {
  private readonly simulator: Simulator;

  constructor(private readonly deps: DecisionDeps) {
    this.simulator = new Simulator(deps);
  }

  async execute(ctx: CallCtx, raw: ScenarioInput): Promise<ScenarioDto> {
    const input = parseOrThrow(scenarioInputSchema, raw);
    const perturbations = input.perturbations.map(p => ({
      rid: p.rid as Rid,
      property: p.property,
      change: p.change,
    }));
    const requested = (input.candidateActions ?? []).map(c => ({
      actionType: c.actionType,
      target: c.target as Rid,
      ...(c.params ? {params: c.params} : {}),
    }));
    const sc = await this.simulator.load(ctx, [
      ...perturbations.map(p => p.rid),
      ...requested.map(c => c.target),
    ]);
    this.simulator.requireNodes(
      sc,
      perturbations.map(p => p.rid),
    );
    const sim = this.simulator.simulate(sc, perturbations);
    const selected = requested.length
      ? await this.simulator.requested(ctx, sc, perturbations, sim, requested)
      : await this.simulator.deterministic(ctx, sc, perturbations, sim);
    const now = this.deps.clock.now();
    const dto: ScenarioDto = {
      id: ulid(now.getTime()),
      name: input.name ?? '',
      perturbations,
      candidates: selected.candidates,
      result: scenarioResult(sc.slice, sim, selected.withActions, now),
      createdAt: now.toISOString(),
    };
    await this.deps.scenarios(ctx.tid).insert(dto);
    return dto;
  }
}

/** GET /scenarios/{id}. */
export class GetScenario {
  constructor(private readonly deps: DecisionDeps) {}

  async execute(ctx: CallCtx, id: string): Promise<ScenarioDto> {
    const s = await this.deps.scenarios(ctx.tid).get(String(id));
    if (!s) throw new AppError('NOT_FOUND', `Scenario ${id} not found`);
    return s;
  }
}
