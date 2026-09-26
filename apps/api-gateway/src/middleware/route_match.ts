/**
 * @fileoverview Resolves the route; 404 NOT_FOUND or 405 with `Allow`.
 */

import {AppError} from '@ontodecide/shared-kernel';
import {PROBLEM_CONTENT_TYPE} from '../http';
import type {GatewayDeps, Middleware} from './chain';

/** Route matching step. */
export function routeMatch(deps: GatewayDeps): Middleware {
  return async (s, next) => {
    const m = deps.router.match(s.method, s.path);
    if (m.kind === 'not_found') {
      throw new AppError('NOT_FOUND', `No route for ${s.method} ${s.path}`);
    }
    if (m.kind === 'method_not_allowed') {
      const problem = {
        ...new AppError('NOT_FOUND').toProblem(s.requestId),
        title: 'Method Not Allowed',
        status: 405,
        detail: `${s.method} is not allowed on ${s.path}`,
      };
      return new Response(JSON.stringify(problem), {
        status: 405,
        headers: {
          'content-type': PROBLEM_CONTENT_TYPE,
          allow: m.allow.join(', '),
        },
      });
    }
    s.route = m.value;
    s.params = m.params;
    return next();
  };
}
