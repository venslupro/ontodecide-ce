/**
 * @fileoverview Ranks candidates with the LLM chain (redacted facts,
 * simulation numbers and the candidate whitelist only), validates the
 * output (one retry) and falls back to rule-based advice.
 */

import type {CallCtx, Rid} from '@ontodecide/shared-kernel';
import type {Perturbation} from '../contract';
import {
  buildAdvicePrompt,
  buildFacts,
  primaryKpi,
  retryPrompt,
  ruleAdvice,
  ruleEvidence,
  RULE_MODEL,
  validateAdvice,
  type Advice,
  type Fact,
  type ScoredCandidate,
  type Simulation,
} from '../domain';
import type {LlmGateway} from './llm_gateway';
import type {SimilarCase} from './ports';
import type {SimContext} from './simulator';

/** Input of {@link Advisor.advise}. */
export interface AdviseInput {
  locale: string;
  focus: Rid;
  focusTitle: string;
  sc: SimContext;
  sim: Simulation;
  perturbations: readonly Perturbation[];
  candidates: readonly ScoredCandidate[];
  cases: readonly SimilarCase[];
}

/** Advice with its provenance. */
export interface AdviseResult {
  advice: Advice;
  model: string;
  /** True when the rule-based fallback replaced the LLM. */
  degraded: boolean;
  neurons: number;
  facts: Fact[];
}

/** Maximum output tokens requested for advice. */
const ADVICE_MAX_TOKENS = 800;

/** Advice generator. */
export class Advisor {
  constructor(private readonly gateway: LlmGateway) {}

  async advise(ctx: CallCtx, input: AdviseInput): Promise<AdviseResult> {
    const {sc, sim} = input;
    const facts = buildFacts(
      sc.model,
      sc.slice.nodes,
      sim.impact.delta,
      input.focus,
    );
    const primary = primaryKpi(sc.model);
    const rules = (degraded: boolean, neurons: number): AdviseResult => ({
      advice: ruleAdvice({
        locale: input.locale,
        focusTitle: input.focusTitle,
        primary,
        baseline: sim.result.baseline[primary.apiName] ?? 0,
        scenario: sim.result.scenario[primary.apiName] ?? 0,
        riskLevel: sim.result.riskLevel,
        affectedCount: sim.result.affected.length,
        candidates: input.candidates,
        evidence: ruleEvidence(facts, input.perturbations, primary),
      }),
      model: RULE_MODEL,
      degraded,
      neurons,
      facts,
    });
    if (!input.candidates.some(c => c.eligible)) return rules(false, 0);
    const validate = (text: string) =>
      validateAdvice(text, input.candidates, facts);
    const prompt = buildAdvicePrompt({
      locale: input.locale,
      focus: input.focus,
      facts,
      kpis: sim.result.kpis,
      baseline: sim.result.baseline,
      scenario: sim.result.scenario,
      riskLevel: sim.result.riskLevel,
      candidates: input.candidates,
      cases: input.cases.map(c => ({
        summary: c.summary,
        ...(c.outcome ? {achievement: c.outcome.achievement} : {}),
      })),
    });
    const opts = {
      json: true,
      maxTokens: ADVICE_MAX_TOKENS,
      accept: (t: string) => validate(t).ok,
    };
    let neurons = 0;
    const first = await this.gateway.complete(ctx, prompt, opts);
    if (first.status !== 'ok') return rules(true, 0);
    neurons += first.neurons;
    const v1 = validate(first.text);
    if (v1.ok) {
      return {
        advice: v1.advice,
        model: first.model,
        degraded: false,
        neurons,
        facts,
      };
    }
    const second = await this.gateway.complete(
      ctx,
      retryPrompt(prompt, first.text, v1.error),
      opts,
    );
    if (second.status !== 'ok') return rules(true, neurons);
    neurons += second.neurons;
    const v2 = validate(second.text);
    if (v2.ok) {
      return {
        advice: v2.advice,
        model: second.model,
        degraded: false,
        neurons,
        facts,
      };
    }
    return rules(true, neurons);
  }
}
