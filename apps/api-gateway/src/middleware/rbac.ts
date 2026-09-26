/**
 * @fileoverview Coarse role check against the route's minimum role.
 * Fine-grained checks (markings, ownership) stay in the services.
 */

import {AppError, hasRole, isRole} from '@ontodecide/shared-kernel';
import {type Middleware, routeOf} from './chain';

/** RBAC step. */
export function rbac(): Middleware {
  return async (s, next) => {
    const access = routeOf(s).minRole;
    if (isRole(access) && !hasRole(s.ctx?.roles ?? [], access)) {
      throw new AppError('FORBIDDEN', `Requires role ${access}`, {
        requiredRole: access,
      });
    }
    return next();
  };
}
