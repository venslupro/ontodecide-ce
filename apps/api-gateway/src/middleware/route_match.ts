/**
 * @fileoverview Route match step: finds the declarative route (404
 * NOT_FOUND otherwise) and resolves its scope.
 */

import {AppError} from '@ontodecide/shared-kernel';
import type {GatewayDeps, Middleware} from './chain';

function parseLoose(raw: string): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Route match step. */
export function routeMatch(deps: GatewayDeps): Middleware {
  return async (s, next) => {
    const m = deps.router.match(s.method, s.path);
    if (m.kind !== 'found') throw new AppError('NOT_FOUND', 'No such route');
    s.route = m.value;
    s.params = m.params;
    const {scope} = m.value;
    s.scope =
      typeof scope === 'function' ? scope(parseLoose(s.rawBody)) : scope;
    return next();
  };
}
