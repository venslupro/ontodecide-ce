/**
 * Provider factory: select the right {@link ILLMProvider} for a given
 * {@link LlmProvider} id and the configured environment.
 *
 * All three providers route through the Cloudflare AI Gateway. Google and
 * Groq are the priority providers (require their respective API keys);
 * Workers AI is the always-available fallback (no key needed).
 */
import { ERROR_CODES, type LlmProvider, throwError } from '@ontodecide/shared';
import type { AiEnv } from '../../types/env.js';
import { AIGatewayProvider } from './gateway.provider.js';
import type { ILLMProvider } from './provider.interface.js';

const PROVIDER_CONSTRUCTORS: Record<LlmProvider, (env: AiEnv) => ILLMProvider> = {
  google: (env) => new AIGatewayProvider(env, 'google'),
  groq: (env) => new AIGatewayProvider(env, 'groq'),
  'workers-ai': (env) => new AIGatewayProvider(env, 'workers-ai'),
};

export class ProviderFactory {
  constructor(private readonly env: AiEnv) {}

  /**
   * Build a provider for the given id (or fall back to the configured
   * default). If the requested provider is unavailable (no API key),
   * silently fall back to Workers AI.
   */
  public get(provider?: LlmProvider): ILLMProvider {
    if (provider && provider in PROVIDER_CONSTRUCTORS) {
      const p = PROVIDER_CONSTRUCTORS[provider](this.env);
      if (this.isUsable(p)) {
        return p;
      }
    }
    const id = this.defaultProviderId();
    const ctor = PROVIDER_CONSTRUCTORS[id];
    if (!ctor) {
      throwError(ERROR_CODES.AI_PROVIDER_UNAVAILABLE, `Unknown provider: ${id}`);
    }
    return ctor(this.env);
  }

  /** Return the list of provider ids that are currently usable. */
  public available(): LlmProvider[] {
    const ids: LlmProvider[] = [];
    for (const id of Object.keys(PROVIDER_CONSTRUCTORS) as LlmProvider[]) {
      const provider = PROVIDER_CONSTRUCTORS[id](this.env);
      if (this.isUsable(provider)) {
        ids.push(id);
      }
    }
    return ids;
  }

  /**
   * A provider is usable when it has the credentials to make calls.
   * Google and Groq require their API keys; Workers AI is always
   * available (Cloudflare account entitlement, no key needed).
   */
  private isUsable(provider: ILLMProvider): boolean {
    switch (provider.id) {
      case 'google':
        return Boolean(this.env.GOOGLE_API_KEY);
      case 'groq':
        return Boolean(this.env.GROQ_API_KEY);
      case 'workers-ai':
        return true;
      default:
        return false;
    }
  }

  /** Priority fallback: Google → Groq → Workers AI. */
  private defaultProviderId(): LlmProvider {
    if (this.env.GOOGLE_API_KEY) return 'google';
    if (this.env.GROQ_API_KEY) return 'groq';
    return 'workers-ai';
  }
}
