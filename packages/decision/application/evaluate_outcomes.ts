/**
 * @fileoverview Daily cron use case: evaluate recommendations executed at
 * least 24 h ago (outcome + case for RAG), expire stale Draft/Proposed
 * recommendations and purge the LLM cache.
 */

import {DAY_MS, systemCtx, type Rid} from '@ontodecide/shared-kernel';
import {
  actionKey,
  caseText,
  computeOutcome,
  primaryKpi,
  transition,
} from '../domain';
import type {DecisionDeps} from './deps';
import type {LlmGateway} from './llm_gateway';
import type {RecommendationRecord} from './ports';
import type {Simulator} from './simulator';
import {pushSummary} from './support';

/** Rows handled per run (keeps the cron inside free-tier CPU limits). */
const BATCH = 100;

/** Evaluates outcomes and expires stale recommendations. */
export class EvaluateOutcomes {
  constructor(
    private readonly deps: DecisionDeps,
    private readonly simulator: Simulator,
    private readonly gateway: LlmGateway,
  ) {}

  async execute(
    nowIso?: string,
  ): Promise<{evaluated: number; expired: number}> {
    const parsed = nowIso ? new Date(nowIso) : this.deps.clock.now();
    const now = Number.isNaN(parsed.getTime()) ? this.deps.clock.now() : parsed;
    const expired = await this.expire(now);
    let evaluated = 0;
    const due = await this.deps.recommendations.listExecutedBefore(
      now.getTime() - DAY_MS,
      BATCH,
    );
    for (const rec of due) {
      try {
        if (await this.evaluate(rec, now)) evaluated++;
      } catch (e) {
        this.deps.logger.error('decision.evaluate_failed', {
          id: rec.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    try {
      await this.gateway.purge(now);
    } catch (e) {
      this.deps.logger.warn('decision.cache_purge_failed', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return {evaluated, expired};
  }

  private async expire(now: Date): Promise<number> {
    let n = 0;
    for (const rec of await this.deps.recommendations.listExpired(
      now.getTime(),
      500,
    )) {
      const next: RecommendationRecord = {
        ...rec,
        status: transition(rec.status, 'Expired'),
      };
      if (await this.deps.recommendations.update(next, rec.status)) {
        n++;
        await pushSummary(
          this.deps.notifier,
          this.deps.logger,
          systemCtx(rec.tenantId),
          next,
        );
      }
    }
    return n;
  }

  private async evaluate(
    rec: RecommendationRecord,
    now: Date,
  ): Promise<boolean> {
    const ctx = systemCtx(rec.tenantId);
    const roots: Rid[] = [
      ...(rec.simulation?.affected ?? [])
        .filter(a => a.hop === 0)
        .map(a => a.rid),
      rec.focus,
    ];
    const sc = await this.simulator.load(ctx, roots);
    const current = this.simulator.run(sc, []);
    const kpi =
      rec.simulation?.kpis?.[0]?.apiName ?? primaryKpi(sc.model).apiName;
    const actual = current.result.baseline[kpi] ?? 0;
    const top =
      rec.actions.find(
        a => a.rank === 1 && a.execution?.status === 'Executed',
      ) ?? rec.actions.find(a => a.rank === 1);
    const expected =
      (top && rec.simulation?.withActions?.[actionKey(top)]?.[kpi]) ??
      rec.simulation?.scenario?.[kpi] ??
      actual;
    const outcome = computeOutcome(expected, actual, now);
    const next: RecommendationRecord = {
      ...rec,
      status: transition(rec.status, 'Evaluated'),
      outcome,
    };
    if (!(await this.deps.recommendations.update(next, rec.status)))
      return false;
    try {
      await this.deps.cases.add({
        id: rec.id,
        tenantId: rec.tenantId,
        summary: rec.summary,
        outcome,
        text: caseText(next),
        createdAt: now.getTime(),
      });
    } catch (e) {
      this.deps.logger.warn('decision.case_store_failed', {
        id: rec.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    await pushSummary(this.deps.notifier, this.deps.logger, ctx, next);
    return true;
  }
}
