/**
 * @fileoverview AI ranking with quotas (详细设计 6.3.5, 6.11.5; 修订说明书
 * 12.6). First the user's daily AI recommendation (dec_usage rec_ai, scope
 * `{tid}:{sub}`) is taken atomically; then, per model call, 1.3 × the
 * estimated Neurons are reserved from the service budget (scope `*`) and
 * settled with the actual usage afterwards. The primary model gets one
 * retry after a rejected output; a timeout or model error skips to the
 * fallback model, which is tried once. Any failure returns null (rules);
 * the user's AI recommendation is then given back.
 */

import {AppError, utcDay, type CallCtx} from '@ontodecide/shared-kernel';
import type {AiRanking} from '../contract';
import {
  estimateNeurons,
  neuronsFor,
  rankingJsonSchema,
  reservation,
  retryPrompt,
  validateRanking,
  type Prompt,
} from '../domain';
import type {AiPort, AiRequest, DecisionDeps} from './ports';

/** Output token cap of both models. */
export const AI_MAX_TOKENS = 1000;

/** Service-wide scope of the Neurons budget. */
export const SERVICE_SCOPE = '*';

/** Counter scope of a user's AI recommendations: `{tid}:{sub}`. */
export function userScope(ctx: Pick<CallCtx, 'tid' | 'sub'>): string {
  return `${ctx.tid}:${ctx.sub}`;
}

/** What the ranker needs besides the context. */
export interface AiRankInput {
  prompt: Prompt;
  candidateIds: string[];
  /** `rid|prop` pairs evidence may reference. */
  keys: Set<string>;
}

/** A validated AI ranking and the model that produced it. */
export interface AiRankOutcome {
  ranking: AiRanking;
  model: string;
}

type CallResult =
  | {kind: 'ok'; ranking: AiRanking}
  | {kind: 'invalid'; error: string}
  | {kind: 'error'}
  | {kind: 'budget'};

/** Ranks candidates with Workers AI under the user and Neurons caps. */
export class AiRanker {
  constructor(private readonly deps: DecisionDeps) {}

  /** Null when quotas are used up, AI is absent or both models fail. */
  async rank(ctx: CallCtx, input: AiRankInput): Promise<AiRankOutcome | null> {
    const ai = this.deps.ai;
    const cfg = this.deps.config;
    if (!ai || input.candidateIds.length === 0) return null;
    const day = utcDay(this.deps.clock.now());
    const scope = userScope(ctx);
    const took = await this.deps.usage.tryTake(
      day,
      scope,
      'rec_ai',
      1,
      cfg.recAiUserDailyLimit,
    );
    if (!took) return null;
    let outcome: AiRankOutcome | null = null;
    try {
      outcome = await this.attempts(ai, day, input);
    } catch (e) {
      this.deps.logger.warn('ai_rank_failed', {
        code: AppError.from(e).code,
      });
    }
    if (!outcome) await this.deps.usage.adjust(day, scope, 'rec_ai', -1);
    return outcome;
  }

  private async attempts(
    ai: AiPort,
    day: string,
    input: AiRankInput,
  ): Promise<AiRankOutcome | null> {
    const cfg = this.deps.config;
    const jsonSchema = rankingJsonSchema();
    const base = {
      jsonSchema,
      maxTokens: AI_MAX_TOKENS,
      timeoutMs: cfg.aiTimeoutMs,
    };
    let prompt = input.prompt;
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await this.call(
        ai,
        day,
        {...base, model: cfg.aiModel, role: 'primary', ...prompt},
        input,
      );
      if (r.kind === 'ok') return {ranking: r.ranking, model: cfg.aiModel};
      if (r.kind === 'budget') return null;
      if (r.kind === 'error') break;
      this.deps.logger.warn('ai_output_rejected', {
        model: cfg.aiModel,
        attempt,
      });
      prompt = retryPrompt(input.prompt, r.error);
    }
    const f = await this.call(
      ai,
      day,
      {
        ...base,
        model: cfg.aiFallbackModel,
        role: 'fallback',
        ...input.prompt,
      },
      input,
    );
    if (f.kind === 'ok') {
      return {ranking: f.ranking, model: cfg.aiFallbackModel};
    }
    return null;
  }

  /** One reserved, settled and validated model call. */
  private async call(
    ai: AiPort,
    day: string,
    req: AiRequest,
    input: AiRankInput,
  ): Promise<CallResult> {
    const cfg = this.deps.config;
    const estimate = estimateNeurons(
      req.model,
      req.system.length + req.user.length,
      req.maxTokens,
    );
    const reserved = reservation(estimate, cfg.neuronsReserveFactor);
    const ok = await this.deps.usage.tryTake(
      day,
      SERVICE_SCOPE,
      'neurons',
      reserved,
      cfg.neuronsDailyBudget,
    );
    if (!ok) return {kind: 'budget'};
    let actual = estimate;
    try {
      const reply = await ai.complete(req);
      if (reply.usage) actual = neuronsFor(req.model, reply.usage);
      const check = validateRanking(
        reply.output,
        input.candidateIds,
        input.keys,
      );
      return check.ok
        ? {kind: 'ok', ranking: check.ranking}
        : {kind: 'invalid', error: check.error};
    } catch (e) {
      this.deps.logger.warn('ai_call_failed', {
        model: req.model,
        code: AppError.from(e).code,
      });
      return {kind: 'error'};
    } finally {
      if (actual !== reserved) {
        await this.deps.usage.adjust(
          day,
          SERVICE_SCOPE,
          'neurons',
          actual - reserved,
        );
      }
    }
  }
}
