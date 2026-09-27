/**
 * @fileoverview Problem Details step: everything thrown further down the
 * chain becomes an RFC 9457 `application/problem+json` response with `code`
 * and `traceId`. Also writes the single-line request log (no PII: only
 * requestId, tid, operationId, status, code and duration).
 */

import {appendHeader, problemResponse, toAppError} from '../http';
import {clearRefreshCookie} from '../cookies';
import type {GatewayDeps, Middleware} from './chain';

/** Problem Details + request log step. */
export function problemDetails(deps: GatewayDeps): Middleware {
  return async (s, next) => {
    let res: Response;
    let code: string | undefined;
    try {
      res = await next();
    } catch (err) {
      const {error, unexpected} = toAppError(err);
      if (unexpected) {
        deps.logger.error('unhandled', {
          requestId: s.requestId,
          op: s.route?.op,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      code = error.code;
      res = problemResponse(error, s.requestId);
      if (s.route?.clearCookieOnError && error.status === 401) {
        res = appendHeader(res, 'set-cookie', clearRefreshCookie());
      }
    }
    deps.logger.info('request', {
      requestId: s.requestId,
      tid: s.ctx?.tid,
      op: s.route?.op,
      method: s.method,
      status: res.status,
      code,
      durationMs: deps.clock.now().getTime() - s.startedAt,
    });
    return res;
  };
}
