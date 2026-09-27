/**
 * @fileoverview Terminal step: calls the route handler (the RPC with its
 * CallCtx). RPC errors are re-thrown for the Problem Details step, which
 * decodes them with AppError.from.
 */

import type {GatewayDeps, GatewayState} from './chain';
import {routeOf} from './chain';

/** Dispatch terminal. */
export function dispatch(
  deps: GatewayDeps,
): (s: GatewayState) => Promise<Response> {
  return s =>
    routeOf(s).handler(deps.env, {
      ctx: s.ctx,
      claims: s.claims,
      params: s.params,
      query: s.query,
      body: s.body,
      ifMatch: s.ifMatch,
      idempotencyKey: s.idempotencyKey,
      stepUp: s.stepUp,
      request: s.request,
      meta: s.meta,
      clock: deps.clock,
      logger: deps.logger,
    });
}
