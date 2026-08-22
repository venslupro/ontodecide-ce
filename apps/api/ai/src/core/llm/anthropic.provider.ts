/**
 * Anthropic (Claude) provider.
 *
 * Uses the Messages API. As with OpenAI, the request can be routed through
 * the Cloudflare AI Gateway when `AI_GATEWAY_ID` is set.
 */
import type { LlmOptions, LlmResponse } from '@ontodecide/shared';
import type { ILLMProvider } from './provider.interface.js';
import type { AiEnv } from '../../types/env.js';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export class AnthropicProvider implements ILLMProvider {
  public readonly id = 'anthropic' as const;

  constructor(private readonly env: AiEnv) {}

  public async generate(prompt: string, options?: LlmOptions): Promise<LlmResponse> {
    const model = options?.model ?? this.env.ANTHROPIC_MODEL;
    const apiKey = this.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set.');
    }
    const url = this.env.AI_GATEWAY_ID
      ? `https://gateway.ai.cloudflare.com/v1/${this.env.AI_GATEWAY_ID}/anthropic/v1/messages`
      : 'https://api.anthropic.com/v1/messages';
    const messages: AnthropicMessage[] = [{ role: 'user', content: prompt }];
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        system: options?.systemPrompt,
        messages,
        max_tokens: options?.maxTokens ?? 2048,
        temperature: options?.temperature ?? 0.7,
      }),
    });
    if (!response.ok) {
      throw new Error(`Anthropic HTTP ${response.status}: ${await response.text()}`);
    }
    const data = (await response.json()) as AnthropicResponse;
    const content = data.content?.find((c) => c.type === 'text')?.text ?? '';
    return {
      content,
      usage: {
        promptTokens: data.usage?.input_tokens ?? this.estimateNeurons(prompt),
        completionTokens: data.usage?.output_tokens ?? this.estimateNeurons(content),
        totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      },
      provider: this.id,
      model,
    };
  }

  public estimateNeurons(prompt: string): number {
    return Math.ceil(prompt.length / 4);
  }
}
