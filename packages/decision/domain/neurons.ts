/**
 * @fileoverview Workers AI Neurons accounting (修订说明书 12.6). Rates are
 * Neurons per million tokens from the Workers AI price list (1,000 Neurons
 * = USD 0.011): qwen3-30b-a3b-fp8 ≈ 38 and gpt-oss-20b ≈ 76 Neurons for a
 * 3,000-input + 800-output-token recommendation.
 */

import {AI_MODELS} from '@ontodecide/shared-kernel';

/** Neurons per million input / output tokens. */
export interface NeuronRate {
  input: number;
  output: number;
}

/** Known model rates; unknown models use the (more expensive) fallback rate. */
export const NEURON_RATES: Record<string, NeuronRate> = {
  [AI_MODELS.primary]: {input: 4625, output: 30455},
  [AI_MODELS.fallback]: {input: 18182, output: 27273},
};

/** Token usage of one model call. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

function rate(model: string): NeuronRate {
  return NEURON_RATES[model] ?? NEURON_RATES[AI_MODELS.fallback];
}

/** Neurons consumed by a call (rounded up). */
export function neuronsFor(model: string, usage: TokenUsage): number {
  const r = rate(model);
  return Math.ceil(
    (Math.max(0, usage.inputTokens) * r.input +
      Math.max(0, usage.outputTokens) * r.output) /
      1_000_000,
  );
}

/**
 * Estimated tokens of a prompt: about 3 characters per token for mixed
 * Chinese / English JSON.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/** Estimated Neurons of a call with `promptChars` and `maxOutput` tokens. */
export function estimateNeurons(
  model: string,
  promptChars: number,
  maxOutput: number,
): number {
  return neuronsFor(model, {
    inputTokens: Math.ceil(promptChars / 3),
    outputTokens: maxOutput,
  });
}

/** Reservation for an estimate (estimate × factor, rounded up, ≥ 1). */
export function reservation(estimate: number, factor: number): number {
  return Math.max(1, Math.ceil(estimate * factor));
}
