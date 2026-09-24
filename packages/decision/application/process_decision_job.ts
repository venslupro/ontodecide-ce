/**
 * @fileoverview decision-jobs consumer use case: simulate the focus,
 * build and score candidates, recall similar cases, rank with the LLM chain
 * (or rules), attach evidence and persist the recommendation as Proposed.
 */

import {
  AppError,
  parseRid,
  type CallCtx,
  type Rid,
} from '@ontodecide/shared-kernel';
import type {ObjectDto} from '@ontodecide/object-graph/contract';
import type {DecisionJobMsg} from '@ontodecide/situation/contract';
import type {Evidence, Perturbation} from '../contract';
import {
  primaryKpi,
  ruleEvidence,
  transition,
  type EvidenceRef,
  type Fact,
} from '../domain';
import type {Advisor} from './advisor';
import type {DecisionDeps} from './deps';
import {newDraft} from './generate_recommendation';
import type {RecommendationRecord, SimilarCase} from './ports';
import {Simulator, validatePerturbations, type SimContext} from './simulator';
import {pushSummary} from './support';

/** Default seed when neither a scenario nor an automation supplies one. */
export const DEFAULT_PERTURBATION = {property: 'capacity', change: -0.5};

/** Maximum evidence items stored per recommendation. */
const EVIDENCE_MAX = 8;

/** Outcome of processing one job. */
export type JobOutcome = 'proposed' | 'failed' | 'skipped';

/** Processes one decision-jobs message. */
export class ProcessDecisionJob {
  constructor(
    private readonly deps: DecisionDeps,
    private readonly simulator: Simulator,
    private readonly advisor: Advisor,
  ) {}

  /**
   * Idempotent: recommendations past Draft are skipped. Transient errors
   * are rethrown (the queue retries) unless `finalAttempt`; other errors
   * mark the recommendation Failed.
   */
  async execute(
    msg: DecisionJobMsg,
    opts: {finalAttempt?: boolean} = {},
  ): Promise<JobOutcome> {
    const ctx = msg?.ctx;
    const focusParts =
      typeof msg?.focus === 'string' ? parseRid(msg.focus) : null;
    if (
      !ctx?.tenantId ||
      !msg.jobId ||
      !focusParts ||
      focusParts.tenantId !== ctx.tenantId
    ) {
      this.deps.logger.warn('decision.job_invalid', {jobId: msg?.jobId});
      return 'skipped';
    }
    const repo = this.deps.recommendations;
    let rec = await repo.get(ctx.tenantId, msg.jobId);
    if (!rec) {
      await repo.insert(
        newDraft(this.deps, {
          id: msg.jobId,
          tenantId: ctx.tenantId,
          focus: msg.focus,
          alertId: msg.alertId,
          scenarioId: msg.scenarioId,
          locale: msg.locale ?? ctx.locale,
          requestedBy: ctx.userId,
          now: this.deps.clock.now(),
        }),
      );
      rec = await repo.get(ctx.tenantId, msg.jobId);
    }
    if (!rec || rec.status !== 'Draft') return 'skipped';
    try {
      return await this.generate(ctx, msg, rec);
    } catch (e) {
      const err = AppError.from(e);
      if (err.status >= 500 && !opts.finalAttempt) throw err;
      this.deps.logger.error('decision.job_failed', {
        jobId: rec.id,
        code: err.code,
        detail: err.detail,
      });
      const failed: RecommendationRecord = {
        ...rec,
        status: transition(rec.status, 'Failed'),
        summary:
          rec.locale === 'en-US'
            ? 'Recommendation generation failed.'
            : '建议生成失败。',
        rationale: `${err.code}${err.detail ? `: ${err.detail}` : ''}`,
      };
      if (await repo.update(failed, 'Draft')) {
        await pushSummary(this.deps.notifier, this.deps.logger, ctx, failed);
      }
      return 'failed';
    }
  }

  private async perturbations(
    ctx: CallCtx,
    msg: DecisionJobMsg,
    rec: RecommendationRecord,
  ): Promise<Perturbation[]> {
    const scenarioId = rec.scenarioId ?? msg.scenarioId;
    if (scenarioId) {
      const s = await this.deps.scenarios.get(ctx.tenantId, scenarioId);
      if (!s)
        throw new AppError('NOT_FOUND', `Scenario ${scenarioId} not found`);
      return validatePerturbations(ctx, s.perturbations);
    }
    return validatePerturbations(ctx, [
      {
        rid: rec.focus,
        property: msg.perturbation?.property ?? DEFAULT_PERTURBATION.property,
        change: msg.perturbation?.change ?? DEFAULT_PERTURBATION.change,
      },
    ]);
  }

  private async generate(
    ctx: CallCtx,
    msg: DecisionJobMsg,
    rec: RecommendationRecord,
  ): Promise<JobOutcome> {
    const perturbations = await this.perturbations(ctx, msg, rec);
    const sc = await this.simulator.load(ctx, [
      ...perturbations.map(p => p.rid),
      rec.focus,
    ]);
    const focusNode = sc.slice.nodes.find(n => n.rid === rec.focus);
    if (!focusNode) {
      throw new AppError('OBJECT_NOT_FOUND', `Focus not found: ${rec.focus}`);
    }
    const sim = this.simulator.run(sc, perturbations);
    const {candidates, withActions} = await this.simulator.candidates(
      ctx,
      sc,
      sim,
      perturbations,
      rec.focus,
      rec.locale,
    );
    const cases = await this.similarCases(
      ctx,
      focusNode.title,
      sc,
      sim.result.affected,
    );
    const adv = await this.advisor.advise(ctx, {
      locale: rec.locale,
      focus: rec.focus,
      focusTitle: focusNode.title,
      sc,
      sim,
      perturbations,
      candidates,
      cases,
    });
    const refs = mergeRefs(
      adv.advice.evidence,
      ruleEvidence(adv.facts, perturbations, primaryKpi(sc.model)),
    );
    const evidence = await this.resolveEvidence(ctx, refs, adv.facts, sc);
    const next: RecommendationRecord = {
      ...rec,
      status: transition(rec.status, 'Proposed'),
      summary: adv.advice.summary,
      rationale: adv.advice.rationale,
      actions: adv.advice.actions,
      evidence,
      risks: adv.advice.risks,
      confidence: adv.advice.confidence,
      model: adv.model,
      degraded: sc.degraded || adv.degraded,
      simulation: {...sim.result, withActions},
    };
    if (!(await this.deps.recommendations.update(next, 'Draft')))
      return 'skipped';
    await pushSummary(this.deps.notifier, this.deps.logger, ctx, next);
    if (adv.neurons > 0) {
      try {
        await this.deps.notifier.recordUsage([
          {resource: 'ai.neurons', n: adv.neurons},
        ]);
      } catch (e) {
        this.deps.logger.warn('decision.usage_failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return 'proposed';
  }

  private async similarCases(
    ctx: CallCtx,
    focusTitle: string,
    sc: SimContext,
    affected: {type: string; title: string}[],
  ): Promise<SimilarCase[]> {
    const types = [...new Set(affected.map(a => a.type))].join(' ');
    const titles = affected
      .slice(0, 5)
      .map(a => a.title)
      .join(' ');
    const text = `${focusTitle} ${types} ${titles} ${Object.keys(sc.model.actionTypes).join(' ')}`;
    try {
      return await this.deps.cases.similar(ctx.tenantId, text, 3);
    } catch (e) {
      this.deps.logger.warn('decision.cases_failed', {
        error: e instanceof Error ? e.message : String(e),
      });
      return [];
    }
  }

  private async resolveEvidence(
    ctx: CallCtx,
    refs: EvidenceRef[],
    facts: readonly Fact[],
    sc: SimContext,
  ): Promise<Evidence[]> {
    let objects: ObjectDto[] = [];
    try {
      objects = await this.deps.graph.getObjects(ctx, [
        ...new Set(refs.map(r => r.rid)),
      ]);
    } catch (e) {
      this.deps.logger.warn('decision.evidence_lookup_failed', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    const byRid = new Map(objects.map(o => [o.rid, o]));
    const nodes = new Map(sc.slice.nodes.map(n => [n.rid, n]));
    const factRids = new Set(facts.map(f => f.rid));
    const out: Evidence[] = [];
    for (const ref of refs) {
      if (!factRids.has(ref.rid)) continue;
      const obj = byRid.get(ref.rid);
      if (obj?.hiddenProps?.includes(ref.prop)) continue;
      const value =
        obj && ref.prop in obj.props
          ? obj.props[ref.prop]
          : nodes.get(ref.rid)?.props[ref.prop];
      if (value === undefined) continue;
      const provenance = obj?.provenance?.[ref.prop];
      out.push({
        rid: ref.rid,
        prop: ref.prop,
        value,
        ...(provenance ? {provenance} : {}),
      });
    }
    return out;
  }
}

function mergeRefs(
  primary: EvidenceRef[],
  extra: EvidenceRef[],
): EvidenceRef[] {
  const out: EvidenceRef[] = [];
  for (const r of [...primary, ...extra]) {
    if (out.length >= EVIDENCE_MAX) break;
    if (!out.some(x => x.rid === r.rid && x.prop === r.prop)) {
      out.push({rid: r.rid as Rid, prop: r.prop});
    }
  }
  return out;
}
