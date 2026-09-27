/**
 * @fileoverview Act-as write audit: before an Act-as write reaches its
 * service, `IDENTITY.audit(tenant.write, operationId)` must succeed; if it
 * fails the write is not forwarded (503 UNAVAILABLE).
 */

import {AppError} from '@ontodecide/shared-kernel';
import {isWriteMethod} from '../route_types';
import type {GatewayDeps, Middleware} from './chain';

/** Act-as write audit step. */
export function actAsAudit(deps: GatewayDeps): Middleware {
  return async (s, next) => {
    if (s.actAs && s.ctx && isWriteMethod(s.method)) {
      try {
        await deps.env.IDENTITY.audit(s.ctx, {
          action: 'tenant.write',
          targetTenantId: s.actAs,
          reason: s.route?.op,
        });
      } catch {
        throw new AppError('UNAVAILABLE', 'Audit unavailable');
      }
    }
    return next();
  };
}
