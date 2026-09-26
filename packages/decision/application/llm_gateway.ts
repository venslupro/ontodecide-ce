/**
 * @fileoverview LLM gateway (anti-corruption layer): per-user and
 * per-tenant daily limits, a one-hour output cache keyed by
 * sha256(prompt + model family), and usage accounting. Provider selection
 * and failover live in the injected {@link LlmPort} (the chain).
 */

import {
  isSystemCtx,
  sha256Hex,
  utcDay,
  type CallCtx,
  type Clock,
  type Logger,
} from '@ontodecide/shared-kernel';
import {DECISION_LIMITS} from '../contract';
import type {Prompt} from '../domain';
import type {LlmPort, LlmStore} from './ports';

/** Result of a gateway call. */
export type GatewayResult =
  | {
      status: 'ok';
      text: string;
      model: string;
      neurons: number;
      cached: boolean;
    }
  | {
      status: 'skipped';
      reason: 'quota' | 'unavailable' | 'failed';
      error?: string;
    };

/** Remaining calls today. */
export interface QuotaView {
  userRemaining: number;
  tenantRemaining: number;
}

/** Options of {@link LlmGateway.complete}. */
export interface GatewayCallOptions {
  json?: boolean;
  maxTokens?: number;
  /** Output is cached only when this accepts it (e.g. passes validation). */
  accept?: (text: string) => boolean;
}

/** LLM gateway. */
export class LlmGateway {
  constructor(
    private readonly llm: LlmPort | null,
    private readonly store: LlmStore,
    private readonly clock: Clock,
    private readonly limits: {user: number; tenant: number},
    private readonly logger: Logger,
  ) {}

  /** Whether a model is configured at all. */
  get available(): boolean {
    return this.llm !== null;
  }

  /** Remaining calls for the caller. System calls only count per tenant. */
  async quota(ctx: CallCtx): Promise<QuotaView> {
    const u = await this.store.usage(
      utcDay(this.clock.now()),
      ctx.tenantId,
      ctx.userId,
    );
    return {
      userRemaining: isSystemCtx(ctx)
        ? Math.max(0, this.limits.tenant - u.tenantCalls)
        : Math.max(0, this.limits.user - u.userCalls),
      tenantRemaining: Math.max(0, this.limits.tenant - u.tenantCalls),
    };
  }

  /** Runs one completion through cache, quota and the provider chain. */
  async complete(
    ctx: CallCtx,
    prompt: Prompt,
    opts: GatewayCallOptions = {},
  ): Promise<GatewayResult> {
    if (!this.llm) return {status: 'skipped', reason: 'unavailable'};
    const now = this.clock.now();
    const hash = await sha256Hex(
      `${this.llm.family}\n${prompt.system}\n${prompt.user}`,
    );
    const hit = await this.store.getCached(
      hash,
      now.getTime() - DECISION_LIMITS.llmCacheTtlMs,
    );
    if (hit && (!opts.accept || opts.accept(hit.output))) {
      return {
        status: 'ok',
        text: hit.output,
        model: hit.model,
        neurons: 0,
        cached: true,
      };
    }
    const q = await this.quota(ctx);
    if (q.userRemaining <= 0 || q.tenantRemaining <= 0) {
      this.logger.info('llm.quota_exhausted', {tenantId: ctx.tenantId});
      return {status: 'skipped', reason: 'quota'};
    }
    try {
      const out = await this.llm.complete(prompt.user, {
        system: prompt.system,
        json: opts.json,
        maxTokens: opts.maxTokens,
      });
      await this.store.recordUsage(
        utcDay(now),
        ctx.tenantId,
        ctx.userId,
        out.model,
        1,
        out.neurons,
      );
      if (!opts.accept || opts.accept(out.text)) {
        await this.store.putCached(hash, out.text, out.model, now.getTime());
      }
      return {
        status: 'ok',
        text: out.text,
        model: out.model,
        neurons: out.neurons,
        cached: false,
      };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.logger.warn('llm.failed', {error});
      return {status: 'skipped', reason: 'failed', error};
    }
  }

  /** Deletes cache entries older than the TTL. */
  purge(now: Date): Promise<number> {
    return this.store.purgeCache(now.getTime() - DECISION_LIMITS.llmCacheTtlMs);
  }
}
