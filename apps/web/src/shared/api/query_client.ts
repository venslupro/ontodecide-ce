/**
 * @fileoverview QueryClient factory with retry rules derived from ApiError.
 */

import {QueryClient} from '@tanstack/react-query';
import {ApiError} from './errors';

/** Whether a failed query should be retried. */
export function shouldRetry(failureCount: number, err: unknown): boolean {
  if (err instanceof ApiError) {
    if (err.code === 'ABORTED') return false;
    if (err.status === 429) return failureCount < 1;
    if (err.status >= 400 && err.status < 500) return false;
  }
  return failureCount < 2;
}

/** Delay between retries; honors Retry-After when present. */
export function retryDelay(attempt: number, err: unknown): number {
  if (err instanceof ApiError && err.retryAfter !== undefined)
    return err.retryAfter * 1000;
  return Math.min(1000 * 2 ** attempt, 8000);
}

/** Creates the app QueryClient. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        retry: shouldRetry,
        retryDelay,
        refetchOnWindowFocus: false,
      },
      mutations: {retry: false},
    },
  });
}
