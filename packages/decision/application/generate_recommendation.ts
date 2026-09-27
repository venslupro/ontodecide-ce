/**
 * @fileoverview generateRecommendation (synchronous, 详细设计 图 7): build
 * the scenario from the focus (or a stored scenario), generate the
 * deterministic candidates, rank them with Workers AI under the quotas or
 * by rules, store the Proposed recommendation (expires in 24 h) and push
 * its summary to the cockpit (best effort).
 */

import {
  AppError,
  HOUR_MS,
  parseOrThrow,
  ulid,
  type CallCtx,
  type Rid,
} from '@ontodecide/shared-kernel';
import {
  DECISION_LIMITS,
  generateInputSchema,
  type GenerateInput,
  type Perturbation,
  type RecommendationDto,
  type ScenarioDto,
} from '../contract';
import {
  actionHints,
  buildFacts,
  buildRankingPrompt,
  factKeys,
  focusPerturbation,
  kpiMeta,
  primaryKpi,
  ruleRanking,
  ruleTexts,
  scenarioResult,
  toDto,
  withValues,
  type RecRecord,
} from '../domain';
import {AiRanker} from './ai_ranker';
import type {DecisionDeps} from './ports';
import {pushSummary} from './push';
import {Simulator} from './simulator';

/** POST /recommendations. */
export class GenerateRecommendation {
  private readonly simulator: Simulator;
  private readonly ranker: AiRanker;

  constructor(private readonly deps: DecisionDeps) {
    this.simulator = new Simulator(deps);
    this.ranker = new AiRanker(deps);
  }

  async execute(ctx: CallCtx, raw: GenerateInput): Promise<RecommendationDto> {
    const input = parseOrThrow(generateInputSchema, raw);
    const focus = input.focus as Rid;
    let stored: ScenarioDto | null = null;
    if (input.scenarioId) {
      stored = await this.deps.scenarios(ctx.tid).get(input.scenarioId);
      if (!stored) {
        throw new AppError(
          'NOT_FOUND',
          `Scenario ${input.scenarioId} not found`,
        );
      }
    }
    const roots = [focus, ...(stored?.perturbations.map(p => p.rid) ?? [])];
    const sc = await this.simulator.load(ctx, roots);
    this.simulator.requireNodes(sc, roots);
    const focusNode = sc.slice.nodes.find(n => n.rid === focus)!;
    const perturbations: Perturbation[] = stored
      ? stored.perturbations
      : [focusPerturbation(sc.schema.objectTypes[focusNode.type], focusNode)];
    const sim = this.simulator.simulate(sc, perturbations);
    const selected = await this.simulator.deterministic(
      ctx,
      sc,
      perturbations,
      sim,
      focus,
    );
    if (selected.candidates.length === 0) {
      throw new AppError('VALIDATION_FAILED', 'NO_CANDIDATES', {status: 422});
    }
    const now = this.deps.clock.now();
    const result = scenarioResult(sc.slice, sim, selected.withActions, now);
    let scenarioId = stored?.id;
    if (!stored) {
      scenarioId = ulid(now.getTime());
      await this.deps.scenarios(ctx.tid).insert({
        id: scenarioId,
        name: focusNode.title.slice(0, 120),
        perturbations,
        candidates: selected.candidates,
        result,
        createdAt: now.toISOString(),
      });
    }

    const facts = buildFacts(
      sc.schema.objectTypes,
      sc.slice.nodes,
      sim.impact,
      focus,
    );
    const keys = factKeys(facts);
    const prompt = buildRankingPrompt({
      locale: ctx.locale,
      focus,
      facts,
      kpis: result.kpis,
      baseline: result.baseline,
      scenario: result.scenario,
      riskLevel: result.riskLevel,
      candidates: selected.candidates,
    });
    const ai = await this.ranker.rank(ctx, {
      prompt,
      candidateIds: selected.candidates.map(c => c.id),
      keys,
    });

    const byRid = new Map(sc.slice.nodes.map(n => [n.rid, n]));
    const lookup = (rid: Rid, prop: string) => byRid.get(rid)?.props[prop];
    const hours = Math.min(
      Math.max(1, this.deps.config.recExpireHours),
      DECISION_LIMITS.recExpireHours,
    );
    const common = {
      id: ulid(now.getTime()),
      status: 'Proposed' as const,
      focus,
      ...(input.alertId ? {alertId: input.alertId} : {}),
      ...(scenarioId ? {scenarioId} : {}),
      candidates: selected.candidates,
      simulation: result,
      locale: ctx.locale,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + hours * HOUR_MS).toISOString(),
      version: 1,
      execAttempts: 0,
    };
    let rec: RecRecord;
    if (ai) {
      const r = ai.ranking;
      rec = {
        ...common,
        summary: r.summary,
        rationale: r.rationale,
        ranking: r.ranking,
        evidence: withValues(r.evidence, lookup),
        risks: r.risks,
        confidence: r.confidence,
        rankedBy: 'ai',
        model: ai.model,
      };
    } else {
      const ranking = ruleRanking(selected.candidates);
      const ranked = ranking.map(id =>
        selected.candidates.find(c => c.id === id)!,
      );
      const texts = ruleTexts({
        locale: ctx.locale,
        focusTitle: focusNode.title,
        result,
        primary: kpiMeta([primaryKpi(sc.schema)])[0],
        ranked,
      });
      const best = ranked[0];
      const bestNode = byRid.get(best.target)!;
      const def = sc.schema.actionTypes[best.actionType];
      const refs = [
        ...perturbations.map(p => ({rid: p.rid, prop: p.property})),
        ...(def ? actionHints(def, bestNode, best.params) : []).map(h => ({
          rid: h.rid,
          prop: h.property,
        })),
      ].filter(r => keys.has(`${r.rid}|${r.prop}`));
      rec = {
        ...common,
        ...texts,
        ranking,
        evidence: withValues(refs, lookup),
        rankedBy: 'rules',
      };
    }
    await this.deps.recommendations(ctx.tid).insert(rec);
    const dto = toDto(rec);
    await pushSummary(this.deps, ctx, dto);
    return dto;
  }
}
