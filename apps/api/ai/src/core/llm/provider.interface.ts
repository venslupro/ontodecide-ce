/**
 * LLM provider interface — the central abstraction of the AI Service.
 *
 * Every concrete provider (Workers AI, OpenAI, Anthropic, Google, AI
 * Gateway) implements this interface, so the higher-level services can be
 * agnostic of which backend serves a given call (strategy pattern + open/
 * closed principle).
 *
 * The bound Cloudflare environment is captured by the provider's
 * constructor (injected via {@link ProviderFactory}); this keeps
 * {@link generate} focused on the call itself rather than on wiring.
 */
import type {LlmOptions, LlmProvider, LlmResponse} from '@ontodecide/shared';

export interface ILLMProvider {
  /** Stable identifier of this provider (matches `LlmProvider`). */
  readonly id: LlmProvider;

  /**
   * Generate a completion for the given prompt.
   *
   * Implementations must normalise the third-party response shape into
   * the {@link LlmResponse} envelope so callers see one shape regardless
   * of the underlying provider.
   */
  generate(prompt: string, options?: LlmOptions): Promise<LlmResponse>;

  /**
   * Estimate the Neuron (or token) cost of a prompt before sending it.
   *
   * The estimate is intentionally coarse (4 chars ~= 1 token) so the
   * budget manager can short-circuit obviously-over-budget calls without
   * needing a tokenizer dependency.
   */
  estimateNeurons(prompt: string): number;
}
