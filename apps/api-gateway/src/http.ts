/**
 * @fileoverview Response helpers: JSON, Problem Details and header merging.
 */

import {AppError} from '@ontodecide/shared-kernel';

/** Media type of RFC 9457 error bodies. */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** JSON response. */
export function jsonResponse(
  body: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  const h = new Headers(headers);
  h.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), {status, headers: h});
}

/**
 * Converts anything thrown into an AppError. Unexpected errors become a
 * bare INTERNAL so internal messages and stacks never reach the client.
 */
export function toAppError(err: unknown): {
  error: AppError;
  unexpected: boolean;
} {
  if (err instanceof AppError) return {error: err, unexpected: false};
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('OD_ERR:')) {
    return {error: AppError.from(err), unexpected: false};
  }
  return {error: new AppError('INTERNAL'), unexpected: true};
}

/** Problem Details response for an error. */
export function problemResponse(
  err: unknown,
  requestId?: string,
  headers: HeadersInit = {},
): Response {
  const {error} = toAppError(err);
  const h = new Headers(headers);
  h.set('content-type', PROBLEM_CONTENT_TYPE);
  const retryAfter = error.extras.retryAfter;
  if (error.code === 'RATE_LIMITED' && typeof retryAfter === 'number') {
    h.set('retry-after', String(retryAfter));
  }
  return new Response(JSON.stringify(error.toProblem(requestId)), {
    status: error.status,
    headers: h,
  });
}

/**
 * Returns the response with extra headers. WebSocket upgrades (101) are
 * returned untouched; immutable responses are re-wrapped.
 */
export function withHeaders(
  res: Response,
  headers: Record<string, string>,
  opts: {overwrite?: boolean} = {},
): Response {
  if (res.status === 101) return res;
  const apply = (target: Response): void => {
    for (const [k, v] of Object.entries(headers)) {
      if (opts.overwrite === false && target.headers.has(k)) continue;
      target.headers.set(k, v);
    }
  };
  try {
    apply(res);
    return res;
  } catch {
    const copy = new Response(res.body, res);
    apply(copy);
    return copy;
  }
}
