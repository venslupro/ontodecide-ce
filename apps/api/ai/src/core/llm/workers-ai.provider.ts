/**
 * Cloudflare Workers AI provider.
 *
 * Uses the native `env.AI.run()` binding, which is free-tier friendly (10k
 * Neurons/day) and requires no API key. The binding's response shape is
 * `{response: string}` for chat models.
 */
import type {LlmOptions, LlmResponse} from '@ontodecide/shared';
import type {ILLMProvider} from './provider.interface.js';
import type {AiEnv} from '../../types/env.js';

interface WorkersAiResponse {
  response?: string;
  result?: {
    response?: string;
  };
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export class WorkersAIProvider implements ILLMProvider {
  public readonly id = 'workers-ai' as const;

  constructor(private readonly env: AiEnv) {}

  public async generate(prompt: string, options?: LlmOptions): Promise<LlmResponse> {
    const model = options?.model ?? this.env.WORKERS_AI_MODEL;
    const inputs = {
      messages: [
        ...(options?.systemPrompt ? [{role: 'system', content: options.systemPrompt}] : []),
        {role: 'user', content: prompt},
      ],
      stream: false,
    };
    const raw = (await this.env.AI.run(model, inputs)) as WorkersAiResponse;
    const content = raw.response ?? raw.result?.response ?? '';
    return {
      content,
      usage: {
        promptTokens: raw.usage?.prompt_tokens ?? this.estimateNeurons(prompt),
        completionTokens: raw.usage?.completion_tokens ?? this.estimateNeurons(content),
        totalTokens: raw.usage?.total_tokens ?? 0,
      },
      provider: this.id,
      model,
    };
  }

  public estimateNeurons(prompt: string): number {
    // Coarse estimate: 4 chars ~= 1 token; 1 token ~= 1 Neuron.
    return Math.ceil(prompt.length / 4);
  }
}
