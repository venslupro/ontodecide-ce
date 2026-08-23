/**
 * AI Gateway provider — unified LLM access through Cloudflare AI Gateway.
 *
 * All three supported providers (Google AI Studio, Groq, Workers AI) route
 * through the gateway's universal chat-completions endpoint. The gateway
 * provides:
 *   • Response caching  — controlled via the `cf-cache-ttl` header
 *   • Budget / rate-limit management — configured at the gateway level
 *   • Unified logging and observability
 *
 * The service layer calls `generate()` directly; no client-side caching
 * or budget gating is needed.
 */
import type { LlmOptions, LlmProvider, LlmResponse } from '@ontodecide/shared';
import type { AiEnv } from '../../types/env.js';
import type { ILLMProvider } from './provider.interface.js';

interface GatewayChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/** Default cache TTL (1 hour) for gateway responses. */
const DEFAULT_CACHE_TTL = 3600;

export class AIGatewayProvider implements ILLMProvider {
  public readonly id: LlmProvider;

  constructor(
    private readonly env: AiEnv,
    id: LlmProvider,
  ) {
    this.id = id;
  }

  public async generate(prompt: string, options?: LlmOptions): Promise<LlmResponse> {
    if (!this.env.AI_GATEWAY_ID) {
      throw new Error('AI_GATEWAY_ID is not configured.');
    }

    const model = options?.model ?? this.pickDefaultModel();
    const url = `https://gateway.ai.cloudflare.com/v1/${this.env.AI_GATEWAY_ID}/chat/completions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'cf-aig-model': model,
      'cf-cache-ttl': String(options?.cacheTtl ?? DEFAULT_CACHE_TTL),
    };
    const token = this.pickApiKey();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          ...(options?.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
          { role: 'user', content: prompt },
        ],
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 2048,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`AI Gateway HTTP ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as GatewayChatResponse;
    const content = data.choices?.[0]?.message?.content ?? '';
    return {
      content,
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
      provider: this.id,
      model,
    };
  }

  /** Pick the default model id for this provider from the environment. */
  private pickDefaultModel(): string {
    switch (this.id) {
      case 'google':
        return this.env.GOOGLE_MODEL;
      case 'groq':
        return this.env.GROQ_MODEL;
      case 'workers-ai':
        return this.env.WORKERS_AI_MODEL;
    }
  }

  /**
   * Pick the API key for this provider.
   *
   * Google and Groq require their respective keys; Workers AI uses the
   * Cloudflare account entitlement via the gateway (no key needed).
   */
  private pickApiKey(): string {
    switch (this.id) {
      case 'google':
        return this.env.GOOGLE_API_KEY ?? '';
      case 'groq':
        return this.env.GROQ_API_KEY ?? '';
      case 'workers-ai':
        return '';
    }
  }
}
