/**
 * @fileoverview AI advice: the zod output schema, whitelist validation of
 * LLM output against the candidate set and the input subgraph, and the
 * rule-based fallback. The LLM may only rank and explain; targets, params
 * and numbers always come from the candidates and the simulator.
 */

import {z} from 'zod';
import {resolveText, type Rid} from '@ontodecide/shared-kernel';
import type {SimulationKpiDef} from '@ontodecide/ontology/contract';
import type {Perturbation, RecommendedAction} from '../contract';
import type {ScoredCandidate} from './candidates';
import type {Fact} from './redaction';
import {factKeys} from './redaction';

/** LLM output schema (detailed design 6.11). */
export const AdviceSchema = z.object({
  summary: z.string().min(1).max(160),
  rationale: z.string().max(2000).optional(),
  actions: z
    .array(
      z.object({
        actionType: z.string(),
        target: z.string().optional(),
        params: z.record(z.string(), z.unknown()).optional().default({}),
        expectedImpact: z.number().optional(),
        rank: z.number().int().min(1),
      }),
    )
    .min(1)
    .max(3),
  risks: z.array(z.string().max(300)).max(5),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.object({rid: z.string(), prop: z.string()})).min(1),
});

/** Raw LLM advice. */
export type AdviceOutput = z.infer<typeof AdviceSchema>;

/** Evidence reference (values are attached by the application). */
export interface EvidenceRef {
  rid: Rid;
  prop: string;
}

/** Validated advice. */
export interface Advice {
  summary: string;
  rationale: string;
  actions: RecommendedAction[];
  risks: string[];
  confidence: number;
  evidence: EvidenceRef[];
}

/** Validation outcome. */
export type AdviceValidation =
  {ok: true; advice: Advice} | {ok: false; error: string};

/**
 * Extracts the first JSON object from model output (tolerates code fences
 * and leading prose). Returns undefined when nothing parses.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidates = [fenced?.[1], trimmed];
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const c of candidates) {
    if (!c) continue;
    try {
      return JSON.parse(c);
    } catch {
      // try next
    }
  }
  return undefined;
}

/** Maps a candidate to a recommended action with the given rank. */
export function toRecommendedAction(
  c: ScoredCandidate,
  rank: number,
): RecommendedAction {
  return {
    actionType: c.actionType,
    displayName: c.displayName,
    target: c.target,
    params: c.params,
    expectedImpact: c.expectedImpact,
    rank,
    requiresApproval: c.requiresApproval,
  };
}

/**
 * Validates LLM output: schema, action whitelist (eligible candidates
 * only; candidate target/params/impact are authoritative) and evidence
 * (rid/prop must appear in the redacted input facts).
 */
export function validateAdvice(
  text: string,
  candidates: readonly ScoredCandidate[],
  facts: readonly Fact[],
): AdviceValidation {
  const json = extractJson(text);
  if (json === undefined) return {ok: false, error: 'Output is not JSON'};
  const parsed = AdviceSchema.safeParse(json);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return {
      ok: false,
      error: `Schema: ${i?.path.join('.') ?? ''} ${i?.message ?? ''}`.trim(),
    };
  }
  const out = parsed.data;
  const eligible = candidates.filter(c => c.eligible);
  const used = new Set<ScoredCandidate>();
  const picked: ScoredCandidate[] = [];
  for (const a of [...out.actions].sort((x, y) => x.rank - y.rank)) {
    const matches = eligible.filter(
      c => c.actionType === a.actionType && !used.has(c),
    );
    if (matches.length === 0) {
      return {ok: false, error: `Action not allowed: ${a.actionType}`};
    }
    const c = a.target
      ? matches.find(m => m.target === a.target)
      : [...matches].sort((x, y) => y.expectedImpact - x.expectedImpact)[0];
    if (!c) {
      return {
        ok: false,
        error: `Target not allowed for ${a.actionType}: ${a.target}`,
      };
    }
    used.add(c);
    picked.push(c);
  }
  const keys = factKeys(facts);
  const evidence: EvidenceRef[] = [];
  for (const e of out.evidence) {
    if (!keys.has(`${e.rid}|${e.prop}`)) {
      return {ok: false, error: `Evidence not in input: ${e.rid}.${e.prop}`};
    }
    if (!evidence.some(x => x.rid === e.rid && x.prop === e.prop)) {
      evidence.push({rid: e.rid as Rid, prop: e.prop});
    }
  }
  return {
    ok: true,
    advice: {
      summary: out.summary,
      rationale: out.rationale ?? '',
      actions: picked.map((c, i) => toRecommendedAction(c, i + 1)),
      risks: out.risks,
      confidence: out.confidence,
      evidence,
    },
  };
}

/** Evidence used by rules: the perturbed properties and the KPI inputs. */
export function ruleEvidence(
  facts: readonly Fact[],
  perturbations: readonly Perturbation[],
  primary: SimulationKpiDef,
  max = 5,
): EvidenceRef[] {
  const out: EvidenceRef[] = [];
  const add = (rid: Rid, prop: string): void => {
    if (out.length >= max) return;
    if (out.some(e => e.rid === rid && e.prop === prop)) return;
    const f = facts.find(x => x.rid === rid);
    if (f && prop in f.props) out.push({rid, prop});
  };
  for (const p of perturbations) add(p.rid, p.property);
  for (const f of facts) {
    if (f.delta === 0) continue;
    if (primary.property && f.type === primary.objectType) {
      add(f.rid, primary.property);
    }
  }
  if (out.length === 0) {
    for (const f of facts) {
      const k = Object.keys(f.props).find(p => typeof f.props[p] === 'number');
      if (k) add(f.rid, k);
      if (out.length) break;
    }
  }
  return out;
}

/** Input of {@link ruleAdvice}. */
export interface RuleAdviceInput {
  locale: string;
  focusTitle: string;
  primary: SimulationKpiDef;
  baseline: number;
  scenario: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  affectedCount: number;
  candidates: readonly ScoredCandidate[];
  evidence: EvidenceRef[];
}

/** Confidence reported by the rule-based fallback. */
export const RULE_CONFIDENCE = 0.6;

/** Model id reported by the rule-based fallback. */
export const RULE_MODEL = 'rules';

function pct(v: number): string {
  return `${Math.round(Math.abs(v) * 1000) / 10}%`;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/** Ranks eligible candidates by expected impact; top 3 (positive first). */
export function ruleRanking(
  candidates: readonly ScoredCandidate[],
): ScoredCandidate[] {
  const eligible = candidates
    .filter(c => c.eligible)
    .sort(
      (a, b) =>
        b.expectedImpact - a.expectedImpact ||
        a.actionType.localeCompare(b.actionType) ||
        a.target.localeCompare(b.target),
    );
  const positive = eligible.filter(c => c.expectedImpact > 0);
  return (positive.length ? positive : eligible).slice(0, 3);
}

/** Rule-based advice with templated text in zh-CN or en-US. */
export function ruleAdvice(input: RuleAdviceInput): Advice {
  const en = input.locale === 'en-US';
  const loc = en ? 'en-US' : 'zh-CN';
  const ranked = ruleRanking(input.candidates);
  const kpiName = resolveText(
    input.primary.displayName,
    loc,
    input.primary.apiName,
  );
  const change =
    input.baseline === 0
      ? 0
      : (input.scenario - input.baseline) / Math.abs(input.baseline);
  const top = ranked[0];
  const topName = top ? resolveText(top.displayName, loc, top.actionType) : '';
  const dir = en
    ? change < 0
      ? 'drop'
      : 'change'
    : change < 0
      ? '下降'
      : '变化';
  let summary: string;
  let rationale: string;
  if (top) {
    summary = en
      ? `${input.focusTitle}: ${kpiName} expected to ${dir} ${pct(change)}. Recommend "${topName}" on ${top.targetTitle} (+${pct(top.expectedImpact)}).`
      : `${input.focusTitle}：${kpiName}预计${dir} ${pct(change)}，建议对「${top.targetTitle}」执行「${topName}」，预计改善 ${pct(top.expectedImpact)}。`;
    const lines = ranked.map((c, i) => {
      const name = resolveText(c.displayName, loc, c.actionType);
      return en
        ? `${i + 1}. ${name} on ${c.targetTitle}: expected ${kpiName} improvement ${pct(c.expectedImpact)}.`
        : `${i + 1}. 对「${c.targetTitle}」执行「${name}」：${kpiName}预计改善 ${pct(c.expectedImpact)}。`;
    });
    rationale = en
      ? `Deterministic simulation: ${kpiName} ${round2(input.baseline)} → ${round2(input.scenario)} across ${input.affectedCount} affected objects. Ranked by simulated benefit:\n${lines.join('\n')}`
      : `确定性推演：${kpiName}由 ${round2(input.baseline)} 变为 ${round2(input.scenario)}，共 ${input.affectedCount} 个对象受影响。按推演收益排序：\n${lines.join('\n')}`;
  } else {
    summary = en
      ? `${input.focusTitle}: ${kpiName} expected to ${dir} ${pct(change)}. No eligible action found; review manually.`
      : `${input.focusTitle}：${kpiName}预计${dir} ${pct(change)}，暂无满足条件的候选动作，请人工研判。`;
    rationale = en
      ? `Deterministic simulation: ${kpiName} ${round2(input.baseline)} → ${round2(input.scenario)}; no candidate action satisfies its preconditions.`
      : `确定性推演：${kpiName}由 ${round2(input.baseline)} 变为 ${round2(input.scenario)}；没有候选动作满足前置条件。`;
  }
  const risks: string[] = [];
  if (input.riskLevel === 'HIGH') {
    risks.push(
      en
        ? `High impact: ${input.affectedCount} objects affected; act promptly.`
        : `影响较大：${input.affectedCount} 个对象受影响，需尽快处置。`,
    );
  }
  if (ranked.some(c => c.requiresApproval)) {
    risks.push(
      en
        ? 'Execution changes business data and requires approval.'
        : '执行将修改业务数据，需要审批确认。',
    );
  }
  risks.push(
    en
      ? 'Generated by rules (AI unavailable); benefit estimates come from the simulator only.'
      : '由规则生成（AI 不可用），收益仅来自推演估算。',
  );
  return {
    summary: truncate(summary, 160),
    rationale,
    actions: ranked.map((c, i) => toRecommendedAction(c, i + 1)),
    risks: risks.slice(0, 5),
    confidence: RULE_CONFIDENCE,
    evidence: input.evidence,
  };
}

function round2(v: number): string {
  return String(Math.round(v * 100) / 100);
}
