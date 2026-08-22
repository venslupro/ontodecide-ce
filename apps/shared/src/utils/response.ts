/**
 * HTTP response helpers shared by all Workers.
 *
 * Every service returns the standard {@link ApiResponse} envelope so the
 * frontend (and tests) can rely on a single shape.
 */
import type { ApiError, ApiResponse } from '../types/common.js';

/** Build a 200 response with `data`. */
export function ok<T>(data: T, traceId?: string): ApiResponse<T> {
  return { success: true, data, traceId };
}

/** Build an error envelope (no HTTP status; that is set by the caller). */
export function fail(
  code: string,
  message: string,
  details?: Record<string, string>,
  traceId?: string,
): ApiResponse<never> {
  return { success: false, error: { code, message, details }, traceId };
}

/** Wrap a thrown value into an {@link ApiError}. */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiErrorImpl) {
    return err;
  }
  const message = err instanceof Error ? err.message : 'Internal error';
  return { code: 'INTERNAL', message };
}

/** A thrown {@link ApiError} that handlers can `catch` and serialise. */
export class ApiErrorImpl extends Error implements ApiError {
  public readonly code: string;
  public readonly details?: Record<string, string>;
  constructor(code: string, message: string, details?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

/** Throw a structured {@link ApiErrorImpl}. */
export function throwError(code: string, message: string): never {
  throw new ApiErrorImpl(code, message);
}

/**
 * Build a JSON `Response` with the envelope and the right status.
 * @param status HTTP status, defaults to 200.
 */
export function jsonResponse<T>(
  body: ApiResponse<T>,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
