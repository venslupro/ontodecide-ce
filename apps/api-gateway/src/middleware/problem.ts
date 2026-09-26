/**
 * @fileoverview Maps anything thrown below into RFC 9457 Problem Details.
 * Unexpected errors become a bare 500 INTERNAL (logged, never leaked).
 */

import {problemResponse, toAppError} from '../http';
import type {GatewayDeps, Middleware} from './chain';

/** Problem Details step. */
export function problemDetails(deps: GatewayDeps): Middleware {
  return async (s, next) => {
    try {
      return await next();
    } catch (err) {
      const {error, unexpected} = toAppError(err);
      if (unexpected) {
        deps.logger.error('unhandled', {
          requestId: s.requestId,
          route: s.route ? `${s.route.method} ${s.route.path}` : s.path,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
      return problemResponse(error, s.requestId);
    }
  };
}
