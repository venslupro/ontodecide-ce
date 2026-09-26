/**
 * @fileoverview Workers AI adapter (`@cf/openai/gpt-oss-20b`).
 */

import type {LlmCompletion, LlmOptions, LlmPort} from '../../application';
import {
  ESTIMATED_NEURONS_PER_CALL,
  LLM_TIMEOUT_MS,
  LlmProviderError,
  withTimeout,
} from './llm_error';

/** The subset of the Workers AI binding used by adapters. */
export interface AiRunner {
  run(model: string, inputs: unknown, options?: unknown): Promise<unknown>;
}

/** Default Workers AI chat model. */
export const WORKERS_AI_MODEL = '@cf/openai/gpt-oss-20b';

/** Extracts text from chat-completions, legacy or Responses API outputs. */
export function workersAiText(out: unknown): string {
  if (typeof out === 'string') return out;
  const o = out as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return '';
  const choices = o.choices as {message?: {content?: unknown}}[] | undefined;
  const content = choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (typeof o.response === 'string') return o.response;
  if (o.response && typeof o.response === 'object')
    return JSON.stringify(o.response);
  if (typeof o.output_text === 'string') return o.output_text;
  const output = o.output as
    {type?: string; content?: {type?: string; text?: string}[]}[] | undefined;
  if (Array.isArray(output)) {
    const texts = output
      .filter(item => item.type === 'message' || item.content)
      .flatMap(item => item.content ?? [])
      .filter(c => typeof c.text === 'string' && c.type !== 'reasoning_text')
      .map(c => c.text!);
    if (texts.length) return texts.join('');
  }
  return '';
}

/** Workers AI chat adapter. */
export class WorkersAiLlm implements LlmPort {
  readonly family: string;

  constructor(
    private readonly ai: AiRunner,
    private readonly model: string = WORKERS_AI_MODEL,
    private readonly timeoutMs: number = LLM_TIMEOUT_MS,
  ) {
    this.family = `workers-ai:${model}`;
  }

  async complete(
    prompt: string,
    opts: LlmOptions = {},
  ): Promise<LlmCompletion> {
    const messages = [
      ...(opts.system ? [{role: 'system', content: opts.system}] : []),
      {role: 'user', content: prompt},
    ];
    let out: unknown;
    try {
      out = await withTimeout(this.timeoutMs, 'workers-ai', () =>
        this.ai.run(this.model, {
          messages,
          max_tokens: opts.maxTokens ?? 800,
          temperature: opts.temperature ?? 0.2,
        }),
      );
    } catch (e) {
      if (e instanceof LlmProviderError) throw e;
      throw new LlmProviderError(String(e), true, undefined, 'workers-ai');
    }
    const text = workersAiText(out);
    if (!text)
      throw new LlmProviderError(
        'workers-ai returned no text',
        true,
        502,
        'workers-ai',
      );
    return {text, model: this.model, neurons: ESTIMATED_NEURONS_PER_CALL};
  }
}
