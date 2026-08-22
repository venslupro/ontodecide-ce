/**
 * OpenAI provider.
 *
 * Calls the OpenAI Chat Completions API directly. When the
 * `AI_GATEWAY_ID` env var is set, the request is routed through the
 * Cloudflare AI Gateway so the platform can apply unified logging,
 * caching, and rate-limiting.
 */
import type { LlmOptions, LlmResponse } from '@ontodecide/shared';
import type { ILLMProvider } from './provider.interface.js';
import type { AiEnv } from '../../types/env.js';

interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export class OpenAIProvider implements ILLMProvider {
  public readonly id = 'openai' as const;

  constructor(private readonly env: AiEnv) {}

  public async generate(prompt: string, options?: LlmOptions): Promise<LlmResponse> {
    const model = options?.model ?? this.env.OPENAI_MODEL;
    const apiKey = this.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set.');
    }
    const url = this.env.AI_GATEWAY_ID
      ? `https://gateway.ai.cloudflare.com/v1/${this.env.AI_GATEWAY_ID}/openai/chat/completions`
      : 'https://api.openai.com/v1/chat/completions';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
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
      throw new Error(`OpenAI HTTP ${response.status}: ${await response.text()}`);
    }
    const data = (await response.json()) as OpenAiChatResponse;
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
}
