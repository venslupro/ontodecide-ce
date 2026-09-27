/**
 * @fileoverview Response helpers: JSON, ETag, Problem Details (RFC 9457)
 * and header merging.
 */

import {AppError, PROBLEM_MEDIA_TYPE, toEtag} from '@ontodecide/shared-kernel';

/** JSON response. */
export function json(
  body: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  const h = new Headers(headers);
  h.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), {status, headers: h});
}

/** JSON response carrying `ETag: "v{version}"`. */
export function jsonWithEtag(
  body: unknown,
  version: number,
  status = 200,
): Response {
  return json(body, status, {etag: toEtag(version)});
}

/** Empty response (204 by default). */
export function empty(status = 204, headers: HeadersInit = {}): Response {
  return new Response(null, {status, headers});
}

/**
 * Converts anything thrown into an AppError. Errors that are not (encoded)
 * AppErrors become a bare INTERNAL so internal messages never leak.
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

/** Problem Details response (`application/problem+json`, with traceId). */
export function problemResponse(err: unknown, traceId?: string): Response {
  const {error} = toAppError(err);
  const h = new Headers({'content-type': PROBLEM_MEDIA_TYPE});
  const retryAfter = error.extras.retryAfter;
  if (typeof retryAfter === 'number') h.set('retry-after', String(retryAfter));
  return new Response(JSON.stringify(error.toProblem(traceId)), {
    status: error.status,
    headers: h,
  });
}

/** Whether a response must be passed through untouched (WebSocket). */
export function isUpgrade(res: Response): boolean {
  return (
    res.status === 101 || !!(res as Response & {webSocket?: unknown}).webSocket
  );
}

/**
 * Returns the response with extra headers. WebSocket upgrades are returned
 * untouched; immutable responses are re-wrapped.
 */
export function withHeaders(
  res: Response,
  headers: Record<string, string>,
): Response {
  if (isUpgrade(res)) return res;
  try {
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
    return res;
  } catch {
    const copy = new Response(res.body, res);
    for (const [k, v] of Object.entries(headers)) copy.headers.set(k, v);
    return copy;
  }
}

/** Appends a header value (e.g. a second Set-Cookie). */
export function appendHeader(
  res: Response,
  name: string,
  value: string,
): Response {
  if (isUpgrade(res)) return res;
  try {
    res.headers.append(name, value);
    return res;
  } catch {
    const copy = new Response(res.body, res);
    copy.headers.append(name, value);
    return copy;
  }
}
