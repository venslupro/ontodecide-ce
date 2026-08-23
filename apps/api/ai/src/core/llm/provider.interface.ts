/**
 * Provider abstraction — every LLM adapter implements this interface.
 *
 * All concrete providers route through the Cloudflare AI Gateway, which
 * provides response caching and budget/rate-limit management at the
 * gateway level. The service layer calls `generate()` directly without
 * any client-side caching or budget gating.
 */
import type { LlmOptions, LlmResponse, LlmProvider } from '@ontodecide/shared';

export interface ILLMProvider {
  /** Stable provider identifier. */
  readonly id: LlmProvider;
  /**
   * Generate a completion for the given prompt.
   *
   * Implementations normalise the upstream response into a
   * {@link LlmResponse} envelope so that the service layer is agnostic
   * to the concrete provider.
   */
  generate(prompt: string, options?: LlmOptions): Promise<LlmResponse>;
}
