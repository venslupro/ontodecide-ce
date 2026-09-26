/**
 * @fileoverview LLM prompt construction. Prompts contain only redacted
 * subgraph facts, simulation numbers and the candidate whitelist.
 */

import type {KpiMeta, KpiSet} from '../contract';
import type {ScoredCandidate} from './candidates';
import type {Fact} from './redaction';

/** A recalled case (RAG). */
export interface CaseHint {
  summary: string;
  achievement?: number;
}

/** A prompt split into system and user parts. */
export interface Prompt {
  system: string;
  user: string;
}

/** Human-readable language name for the output instruction. */
export function languageName(locale: string): string {
  return locale === 'en-US' ? 'English (en-US)' : 'Simplified Chinese (zh-CN)';
}

/** Input of {@link buildAdvicePrompt}. */
export interface AdvicePromptInput {
  locale: string;
  focus: string;
  facts: readonly Fact[];
  kpis: readonly KpiMeta[];
  baseline: KpiSet;
  scenario: KpiSet;
  riskLevel: string;
  candidates: readonly ScoredCandidate[];
  cases: readonly CaseHint[];
}

const ADVICE_SHAPE =
  '{"summary": string (<= 160 chars), "rationale": string, "actions": [{"actionType": string, "target": string, "params": object, "expectedImpact": number, "rank": integer >= 1}] (1-3 items), "risks": string[] (<= 5), "confidence": number 0..1, "evidence": [{"rid": string, "prop": string}] (>= 1)}';

/** Builds the recommendation ranking prompt. */
export function buildAdvicePrompt(input: AdvicePromptInput): Prompt {
  const lang = languageName(input.locale);
  const system = [
    'You are a decision-support analyst for an ontology-based operations platform.',
    'You rank candidate actions and explain them. You never invent actions, targets, parameters or numbers.',
    `Reply with a single JSON object only, matching: ${ADVICE_SHAPE}.`,
    `Write "summary", "rationale" and "risks" in ${lang}.`,
    'Rules: pick actions only from CANDIDATES and copy their actionType and target;',
    'numbers come from SIMULATION and CANDIDATES.expectedImpact;',
    'every evidence item must reference a rid and a property key present in FACTS.',
  ].join('\n');
  const candidates = input.candidates
    .filter(c => c.eligible)
    .map(c => ({
      actionType: c.actionType,
      target: c.target,
      targetTitle: c.targetTitle,
      params: c.params,
      expectedImpact: c.expectedImpact,
      requiresApproval: c.requiresApproval,
    }));
  const user = [
    `FOCUS: ${input.focus}`,
    `FACTS: ${JSON.stringify(input.facts)}`,
    `SIMULATION: ${JSON.stringify({
      kpis: input.kpis.map(k => ({
        apiName: k.apiName,
        higherIsBetter: k.higherIsBetter,
        unit: k.unit,
      })),
      baseline: input.baseline,
      scenario: input.scenario,
      riskLevel: input.riskLevel,
    })}`,
    `CANDIDATES: ${JSON.stringify(candidates)}`,
    `SIMILAR_CASES: ${JSON.stringify(input.cases)}`,
  ].join('\n');
  return {system, user};
}

/** Appends a correction request after a failed validation. */
export function retryPrompt(
  p: Prompt,
  previous: string,
  error: string,
): Prompt {
  return {
    system: p.system,
    user: `${p.user}\nYOUR_PREVIOUS_OUTPUT: ${previous.slice(0, 2000)}\nIT_WAS_REJECTED_BECAUSE: ${error}\nReturn corrected JSON only.`,
  };
}
