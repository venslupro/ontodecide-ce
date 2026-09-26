/**
 * @fileoverview Terminal step: invokes the route handler and encodes its
 * result (DTO → JSON, undefined → 204, Response → as is).
 */

import type {Env} from '../env';
import {jsonResponse} from '../http';
import {type GatewayDeps, type GatewayState, routeOf} from './chain';

/** Creates the dispatcher. */
export function dispatch(
  deps: GatewayDeps,
): (s: GatewayState) => Promise<Response> {
  const env: Env = deps.env;
  return async s => {
    const route = routeOf(s);
    if (!s.ctx) throw new Error('ctx not built');
    const result = await route.handler(env, {
      ctx: s.ctx,
      params: s.params,
      query: s.query,
      body: s.body,
      headers: s.request.headers,
      rawBody: s.rawBody,
      request: s.request,
      logger: deps.logger,
    });
    if (result instanceof Response) return result;
    if (result === undefined || route.status === 204) {
      return new Response(null, {status: route.status ?? 204});
    }
    return jsonResponse(result, route.status ?? 200);
  };
}
