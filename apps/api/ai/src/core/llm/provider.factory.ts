/**
 * Provider factory: select the right {@link ILLMProvider} for a given
 * {@link LlmProvider} id and the configured environment.
 *
 * The factory pattern keeps the higher-level services (ScenarioService,
 * RecommendationService) free of provider-specific knowledge — they ask for
 * a provider by id and get back a working instance (or a fallback when the
 * requested provider has no credentials).
 */
import { ERROR_CODES, type LlmProvider, throwError } from '@ontodecide/shared';
import type { AiEnv } from '../../types/env.js';
import { AIGatewayProvider } from './gateway.provider.js';
import { AnthropicProvider } from './anthropic.provider.js';
import { OpenAIProvider } from './openai.provider.js';
import { WorkersAIProvider } from './workers-ai.provider.js';
import type { ILLMProvider } from './provider.interface.js';

const PROVIDER_CONSTRUCTORS: Record<LlmProvider, (env: AiEnv) => ILLMProvider> = {
  'workers-ai': (env) => new WorkersAIProvider(env),
  openai: (env) => new OpenAIProvider(env),
  anthropic: (env) => new AnthropicProvider(env),
  google: (env) => new AIGatewayProvider(env, 'google'),
  openrouter: (env) => new AIGatewayProvider(env, 'openrouter'),
};

export class ProviderFactory {
  constructor(private readonly env: AiEnv) {}

  /** Build a provider for the given id (or fall back to the configured default). */
  public get(provider?: LlmProvider): ILLMProvider {
    const id = provider ?? this.defaultProviderId();
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

  /** A provider is usable when it can produce a non-empty response. */
  private isUsable(provider: ILLMProvider): boolean {
    // WorkersAI is always usable (free binding); others require keys.
    if (provider.id === 'workers-ai') {
      return Boolean((this.env as { AI?: unknown }).AI);
    }
    if (provider.id === 'openai') {
      return Boolean(this.env.OPENAI_API_KEY);
    }
    if (provider.id === 'anthropic') {
      return Boolean(this.env.ANTHROPIC_API_KEY);
    }
    if (provider.id === 'google' || provider.id === 'openrouter') {
      return (
        Boolean(this.env.AI_GATEWAY_ID) &&
        Boolean(this.env.AI_GATEWAY_TOKEN || this.env.OPENROUTER_API_KEY)
      );
    }
    return false;
  }

  private defaultProviderId(): LlmProvider {
    const fromEnv = this.env.AI_DEFAULT_PROVIDER as LlmProvider | undefined;
    if (fromEnv && fromEnv in PROVIDER_CONSTRUCTORS) {
      return fromEnv;
    }
    return 'workers-ai';
  }
}
