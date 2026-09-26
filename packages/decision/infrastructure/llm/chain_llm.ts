/**
 * @fileoverview Provider chain: tries providers in LLM_CHAIN order and
 * switches on 429 / quota / 5xx / timeout (and on any other provider
 * failure, so one misconfigured provider never blocks the rest).
 */

import type {Logger} from '@ontodecide/shared-kernel';
import type {LlmCompletion, LlmOptions, LlmPort} from '../../application';
import {
  GeminiLlm,
  GEMINI_MODEL,
  GroqLlm,
  GROQ_MODEL,
  type FetchFn,
} from './http_llm';
import {LlmProviderError} from './llm_error';
import {WorkersAiLlm, WORKERS_AI_MODEL, type AiRunner} from './workers_ai_llm';

/** A named provider. */
export interface NamedProvider {
  name: string;
  llm: LlmPort;
}

/** Chain of providers. */
export class ChainLlm implements LlmPort {
  readonly family: string;

  constructor(
    private readonly providers: NamedProvider[],
    private readonly logger: Logger,
  ) {
    this.family = `chain:${providers.map(p => p.name).join(',')}`;
  }

  async complete(prompt: string, opts?: LlmOptions): Promise<LlmCompletion> {
    const errors: string[] = [];
    for (const p of this.providers) {
      try {
        return await p.llm.complete(prompt, opts);
      } catch (e) {
        const retryable = e instanceof LlmProviderError ? e.retryable : true;
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${p.name}: ${msg}`);
        this.logger.warn('llm.provider_failed', {
          provider: p.name,
          retryable,
          error: msg,
        });
      }
    }
    throw new LlmProviderError(
      `All LLM providers failed (${errors.join('; ')})`,
      true,
    );
  }
}

/** Inputs of {@link buildLlmChain}. */
export interface ChainConfig {
  /** Comma separated provider names (LLM_CHAIN). */
  chain?: string;
  ai?: AiRunner;
  geminiApiKey?: string;
  groqApiKey?: string;
  fetch: FetchFn;
  logger: Logger;
  timeoutMs?: number;
}

/** Default provider order. */
export const DEFAULT_LLM_CHAIN = 'workers-ai,gemini,groq';

/**
 * Builds the chain from LLM_CHAIN, skipping providers without a binding or
 * key. Returns null when no provider is usable (rules only).
 */
export function buildLlmChain(cfg: ChainConfig): LlmPort | null {
  const names = (cfg.chain || DEFAULT_LLM_CHAIN)
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  const providers: NamedProvider[] = [];
  for (const name of names) {
    if (providers.some(p => p.name === name)) continue;
    if (name === 'workers-ai' && cfg.ai) {
      providers.push({
        name,
        llm: new WorkersAiLlm(cfg.ai, WORKERS_AI_MODEL, cfg.timeoutMs),
      });
    } else if (name === 'gemini' && cfg.geminiApiKey) {
      providers.push({
        name,
        llm: new GeminiLlm(
          cfg.geminiApiKey,
          cfg.fetch,
          GEMINI_MODEL,
          cfg.timeoutMs,
        ),
      });
    } else if (name === 'groq' && cfg.groqApiKey) {
      providers.push({
        name,
        llm: new GroqLlm(cfg.groqApiKey, cfg.fetch, GROQ_MODEL, cfg.timeoutMs),
      });
    }
  }
  return providers.length ? new ChainLlm(providers, cfg.logger) : null;
}
