/**
 * @fileoverview Recommendation aggregate helpers (详细设计 图 8 建议状态机):
 * Proposed → Confirmed → Executed | ExecFailed (re-executable ≤ 3 times),
 * Proposed → Rejected, Proposed → Expired (evaluated on read). Also the
 * bilingual rule-ranking texts and the cockpit summary.
 */

import {
  AppError,
  resolveText,
  type CallCtx,
  type Rid,
} from '@ontodecide/shared-kernel';
import type {RecommendationSummary} from '@ontodecide/situation/contract';
import {
  DECISION_LIMITS,
  type Candidate,
  type Evidence,
  type KpiMeta,
  type RecStatus,
  type RecommendationDto,
  type ScenarioResult,
} from '../contract';

/** Stored recommendation: the DTO plus decision bookkeeping. */
export interface RecRecord extends RecommendationDto {
  decisionKey?: string;
  execAttempts: number;
}

/** Whether a Proposed recommendation is past its expiry. */
export function isDue(
  rec: Pick<RecommendationDto, 'status' | 'expiresAt'>,
  now: Date,
): boolean {
  return (
    rec.status === 'Proposed' && Date.parse(rec.expiresAt) <= now.getTime()
  );
}

/** Statuses from which a decision was taken. */
export const DECIDED: readonly RecStatus[] = [
  'Confirmed',
  'Rejected',
  'Executed',
  'ExecFailed',
];

/** Whether a failed execution may be retried. */
export function canRetryExecution(rec: RecRecord): boolean {
  return (
    rec.status === 'ExecFailed' &&
    rec.execAttempts < DECISION_LIMITS.execAttemptsMax
  );
}

/** The human role recorded as `decided_by`; services cannot decide. */
export function decidedByRole(ctx: CallCtx): 'owner' | 'admin' {
  if (ctx.actor.role === 'owner' || ctx.actor.role === 'admin') {
    return ctx.actor.role;
  }
  throw new AppError('FORBIDDEN', 'Only a person can decide');
}

/** Strips internal fields. */
export function toDto(rec: RecRecord): RecommendationDto {
  const {decisionKey: _k, execAttempts: _a, ...dto} = rec;
  return dto;
}

/** Candidate executed on confirmation (ranking[0]). */
export function bestCandidate(
  rec: Pick<RecommendationDto, 'ranking' | 'candidates'>,
): Candidate | undefined {
  return rec.candidates.find(c => c.id === rec.ranking[0]);
}

/** Summary pushed to the cockpit. */
export function toSummary(rec: RecommendationDto): RecommendationSummary {
  return {
    id: rec.id,
    status: rec.status,
    summary: rec.summary,
    confidence: rec.confidence,
    rankedBy: rec.rankedBy,
    focus: rec.focus,
    expectedImpact: bestCandidate(rec)?.expectedImpact ?? 0,
    createdAt: rec.createdAt,
    expiresAt: rec.expiresAt,
    ...(rec.simulation ? {impacted: rec.simulation.affected.slice(0, 5)} : {}),
  };
}

function pct(v: number): string {
  const p = Math.round(v * 1000) / 10;
  return `${p > 0 ? '+' : ''}${p}%`;
}

/** Input of {@link ruleTexts}. */
export interface RuleTextInput {
  locale: string;
  focusTitle: string;
  result: Pick<ScenarioResult, 'riskLevel' | 'affected'>;
  primary: KpiMeta;
  ranked: readonly Candidate[];
}

/** Rule-ranking texts (zh-CN / en-US templates; reproducible). */
export function ruleTexts(input: RuleTextInput): {
  summary: string;
  rationale: string;
  risks: string[];
  confidence: number;
} {
  const en = input.locale === 'en-US';
  const best = input.ranked[0];
  const action = resolveText(best.displayName, input.locale, best.actionType);
  const kpi = resolveText(
    input.primary.displayName,
    input.locale,
    input.primary.apiName,
  );
  const n = input.result.affected.length;
  const risk = input.result.riskLevel;
  const summary = (
    en
      ? `Rule ranking: ${action} on ${best.targetTitle} (${kpi} ${pct(best.expectedImpact)})`
      : `规则排序：对 ${best.targetTitle} 执行「${action}」（${kpi} ${pct(best.expectedImpact)}）`
  ).slice(0, 160);
  const order = input.ranked
    .map(c => {
      const a = resolveText(c.displayName, input.locale, c.actionType);
      return en
        ? `${c.id} ${a} → ${c.targetTitle}: ${pct(c.expectedImpact)}, ${c.affectedCount} objects`
        : `${c.id} ${a} → ${c.targetTitle}：${pct(c.expectedImpact)}，影响 ${c.affectedCount} 个对象`;
    })
    .join(en ? '; ' : '；');
  const rationale = (
    en
      ? `The simulation of ${input.focusTitle} affects ${n} objects (risk ${risk}). Candidates are ordered by expected ${kpi} improvement (desc), then affected objects (asc), then action name: ${order}.`
      : `对 ${input.focusTitle} 的推演影响 ${n} 个对象（风险等级 ${risk}）。候选按预期 ${kpi} 改善降序、影响对象数升序、动作名称排序：${order}。`
  ).slice(0, 800);
  const risks: string[] = [];
  if (risk === 'HIGH') {
    risks.push(
      en
        ? 'High risk: impacts reach downstream objects within 2 hops.'
        : '高风险：影响在 2 跳内传导到下游对象。',
    );
  }
  if (best.expectedImpact <= 0) {
    risks.push(
      en
        ? 'No candidate improves the primary KPI in the simulation.'
        : '推演中没有候选能改善主要指标。',
    );
  }
  risks.push(
    en
      ? 'Ranked by deterministic rules without AI.'
      : '未使用 AI，按确定性规则排序。',
  );
  return {
    summary,
    rationale,
    risks,
    confidence: best.expectedImpact > 0 ? 0.6 : 0.3,
  };
}

/** Evidence value lookup. */
export type PropLookup = (rid: Rid, prop: string) => unknown;

/** Evidence items with their current values. */
export function withValues(
  refs: readonly {rid: string; prop: string}[],
  lookup: PropLookup,
): Evidence[] {
  const seen = new Set<string>();
  const out: Evidence[] = [];
  for (const r of refs) {
    const key = `${r.rid}|${r.prop}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      rid: r.rid as Rid,
      prop: r.prop,
      value: lookup(r.rid as Rid, r.prop) ?? null,
    });
  }
  return out;
}
