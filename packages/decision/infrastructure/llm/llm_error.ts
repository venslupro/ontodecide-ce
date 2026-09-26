/**
 * @fileoverview Provider errors and timeout helper shared by LLM adapters.
 */

import {DECISION_LIMITS} from '../../contract';

/** Error raised by an LLM provider adapter. */
export class LlmProviderError extends Error {
  constructor(
    message: string,
    /** 429, quota, 5xx and timeouts: the chain switches provider. */
    readonly retryable: boolean,
    readonly status?: number,
    readonly provider?: string,
  ) {
    super(message);
    this.name = 'LlmProviderError';
  }
}

/** Neurons assumed per call when the provider reports none (~3k in + 800 out tokens). */
export const ESTIMATED_NEURONS_PER_CALL = 76;

/** Default provider timeout. */
export const LLM_TIMEOUT_MS = DECISION_LIMITS.llmTimeoutMs;

/** Whether an HTTP status (and body) should make the chain switch provider. */
export function isRetryableStatus(status: number, body = ''): boolean {
  if (status === 429 || status === 408 || status >= 500) return true;
  return /quota|rate.?limit|exhausted|capacity/i.test(body);
}

/**
 * Runs `fn` with an AbortSignal that fires after `ms`; rejects with a
 * retryable timeout error even when the callee ignores the signal.
 */
export async function withTimeout<T>(
  ms: number,
  provider: string,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new LlmProviderError(
          `${provider} timed out after ${ms} ms`,
          true,
          408,
          provider,
        ),
      );
    }, ms);
  });
  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } catch (e) {
    if (e instanceof LlmProviderError) throw e;
    if (controller.signal.aborted) {
      throw new LlmProviderError(
        `${provider} timed out after ${ms} ms`,
        true,
        408,
        provider,
      );
    }
    throw new LlmProviderError(
      `${provider} failed: ${e instanceof Error ? e.message : String(e)}`,
      true,
      undefined,
      provider,
    );
  } finally {
    clearTimeout(timer);
  }
}
