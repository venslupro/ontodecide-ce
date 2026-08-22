/**
 * AI Gateway provider.
 *
 * Calls the Cloudflare AI Gateway generic chat completions endpoint. This
 * is the recommended path for any third-party model that supports the
 * OpenAI-compatible schema (Google Gemini via its OpenAI-compatible
 * endpoint, OpenRouter aggregation, etc.).
 */
import type { LlmOptions, LlmProvider, LlmResponse } from '@ontodecide/shared';
import type { ILLMProvider } from './provider.interface.js';
import type { AiEnv } from '../../types/env.js';

interface GatewayChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export class AIGatewayProvider implements ILLMProvider {
  public readonly id: LlmProvider;

  constructor(
    private readonly env: AiEnv,
    /** Override the provider id so the same class can be reused for Google. */
    id: LlmProvider = 'openrouter',
  ) {
    this.id = id;
  }

  public async generate(prompt: string, options?: LlmOptions): Promise<LlmResponse> {
    if (!this.env.AI_GATEWAY_ID) {
      throw new Error('AI_GATEWAY_ID is not set.');
    }
    const model = options?.model ?? this.pickDefaultModel();
    const token = this.env.AI_GATEWAY_TOKEN ?? this.pickApiKey();
    const url = `https://gateway.ai.cloudflare.com/v1/${this.env.AI_GATEWAY_ID}/chat/completions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'cf-aig-model': model,
      },
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
        promptTokens: data.usage?.prompt_tokens ?? this.estimateNeurons(prompt),
        completionTokens: data.usage?.completion_tokens ?? this.estimateNeurons(content),
        totalTokens: data.usage?.total_tokens ?? 0,
      },
      provider: this.id,
      model,
    };
  }

  public estimateNeurons(prompt: string): number {
    return Math.ceil(prompt.length / 4);
  }

  /** Pick the default model id based on the configured provider id. */
  private pickDefaultModel(): string {
    switch (this.id) {
      case 'google':
        return this.env.GOOGLE_MODEL;
      case 'openrouter':
        return this.env.OPENROUTER_MODEL;
      default:
        return this.env.OPENAI_MODEL;
    }
  }

  /** Pick the API key based on the configured provider id. */
  private pickApiKey(): string {
    switch (this.id) {
      case 'google':
        return this.env.GOOGLE_API_KEY ?? '';
      case 'openrouter':
        return this.env.OPENROUTER_API_KEY ?? '';
      default:
        return this.env.OPENAI_API_KEY ?? '';
    }
  }
}
