/**
 * @fileoverview Typed API error mapped from RFC 9457 Problem Details.
 */

import type {ErrorCode, Problem} from '@ontodecide/shared-kernel';

/** Client-side codes in addition to the server's {@link ErrorCode}s. */
export type ClientErrorCode = 'NETWORK' | 'ABORTED' | 'HTTP_ERROR';

/** Error thrown by the API client for every non-2xx response. */
export class ApiError extends Error {
  readonly code: ErrorCode | ClientErrorCode;
  readonly status: number;
  readonly detail?: string;
  /** Seconds to wait before retrying (429 / 503). */
  readonly retryAfter?: number;
  readonly requestId?: string;
  /** Problem extension members (e.g. `errors`, `unmet`, `recommendationId`). */
  readonly extras: Record<string, unknown>;

  constructor(init: {
    code: ErrorCode | ClientErrorCode;
    status: number;
    detail?: string;
    retryAfter?: number;
    requestId?: string;
    extras?: Record<string, unknown>;
  }) {
    super(init.detail ? `${init.code}: ${init.detail}` : init.code);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status;
    this.detail = init.detail;
    this.retryAfter = init.retryAfter;
    this.requestId = init.requestId;
    this.extras = init.extras ?? {};
  }
}

/** Whether the value is an {@link ApiError}, optionally with one of the codes. */
export function isApiError(
  err: unknown,
  ...codes: (ErrorCode | ClientErrorCode)[]
): err is ApiError {
  return (
    err instanceof ApiError && (codes.length === 0 || codes.includes(err.code))
  );
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  if (Number.isFinite(n)) return Math.max(0, n);
  const at = Date.parse(value);
  return Number.isNaN(at)
    ? undefined
    : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/** Builds an ApiError from a failed response. */
export async function toApiError(res: Response): Promise<ApiError> {
  let problem: Partial<Problem> = {};
  try {
    const text = await res.text();
    if (text) problem = JSON.parse(text) as Partial<Problem>;
  } catch {
    // Non-JSON error body.
  }
  const {
    type: _t,
    title: _ti,
    status: _s,
    code,
    detail,
    requestId,
    ...extras
  } = problem;
  return new ApiError({
    code: (code as ErrorCode | undefined) ?? 'HTTP_ERROR',
    status: res.status,
    detail: typeof detail === 'string' ? detail : undefined,
    requestId:
      (requestId as string | undefined) ??
      res.headers.get('x-request-id') ??
      undefined,
    retryAfter: parseRetryAfter(res.headers.get('retry-after')),
    extras,
  });
}
