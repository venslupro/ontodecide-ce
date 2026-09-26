/**
 * @fileoverview Deterministic LlmPort for tests: replies from a scripted
 * list (strings, errors or functions of the prompt) and records prompts.
 */

import type {LlmCompletion, LlmOptions, LlmPort} from '../../application';
import {ESTIMATED_NEURONS_PER_CALL} from './llm_error';

/** One scripted reply. */
export type FakeReply =
  string | Error | ((prompt: string, opts: LlmOptions) => string);

/** FakeLlm settings. */
export interface FakeLlmOptions {
  /** Consumed in order; the last one repeats. */
  replies?: FakeReply[];
  model?: string;
  neurons?: number;
}

/** Deterministic fake model. */
export class FakeLlm implements LlmPort {
  readonly family: string;
  readonly calls: {prompt: string; opts: LlmOptions}[] = [];
  private replies: FakeReply[];
  private readonly model: string;
  private readonly neurons: number;

  constructor(opts: FakeLlmOptions = {}) {
    this.replies = opts.replies ?? ['{}'];
    this.model = opts.model ?? 'fake-llm';
    this.neurons = opts.neurons ?? ESTIMATED_NEURONS_PER_CALL;
    this.family = `fake:${this.model}`;
  }

  /** Replaces the scripted replies. */
  script(...replies: FakeReply[]): void {
    this.replies = replies;
  }

  async complete(
    prompt: string,
    opts: LlmOptions = {},
  ): Promise<LlmCompletion> {
    this.calls.push({prompt, opts});
    const reply =
      this.replies.length > 1 ? this.replies.shift()! : this.replies[0];
    if (reply instanceof Error) throw reply;
    const text = typeof reply === 'function' ? reply(prompt, opts) : reply;
    return {text, model: this.model, neurons: this.neurons};
  }
}
