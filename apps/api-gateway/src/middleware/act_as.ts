/**
 * @fileoverview CallCtx and Act-as-Tenant step (修订说明书 6.4, 详细设计
 * 6.11.7). Builds the CallCtx from the verified claims; for an admin
 * sending `X-Act-As-Tenant` on a `workspace` route the target must exist
 * and be `kind = trial` (404 otherwise, the same answer as an unknown id),
 * and writes need it ACTIVE (409 CONFLICT). Owners sending the header get
 * 403. The first entry within the status cache window records
 * `act_as.enter` through IDENTITY.audit (failure → 503 UNAVAILABLE).
 * `admin` routes never act as another tenant and ignore the header.
 */

import {ACT_AS_HEADER, AppError, type CallCtx} from '@ontodecide/shared-kernel';
import {isWriteMethod} from '../route_types';
import type {GatewayDeps, Middleware} from './chain';

/** Act-as step. */
export function actAs(deps: GatewayDeps): Middleware {
  return async (s, next) => {
    const claims = s.claims;
    if (!claims) return next();
    const base: CallCtx = {
      tid: claims.tid,
      sub: claims.sub,
      actor: {role: claims.role, userId: claims.sub, actingAs: false},
      requestId: s.requestId,
      locale: s.locale,
    };
    s.ctx = base;
    const target = s.request.headers.get(ACT_AS_HEADER)?.trim();
    if (!target) return next();
    if (claims.role !== 'admin') {
      throw new AppError('FORBIDDEN', 'Act-as is for the admin only');
    }
    if (s.scope !== 'workspace' || s.route?.ownAccount) return next();
    if (!/^[0-9A-Z]{26}$/.test(target)) throw new AppError('NOT_FOUND');
    const entry = await deps.actAs.get(target);
    if (!entry.status || entry.status.kind !== 'trial') {
      throw new AppError('NOT_FOUND');
    }
    if (isWriteMethod(s.method) && entry.status.status !== 'ACTIVE') {
      throw new AppError('CONFLICT', 'Target workspace is not ACTIVE', {
        extras: {status: entry.status.status},
      });
    }
    const ctx: CallCtx = {
      ...base,
      tid: target,
      actor: {role: 'admin', userId: claims.sub, actingAs: true},
    };
    if (!entry.entered) {
      try {
        await deps.env.IDENTITY.audit(ctx, {
          action: 'act_as.enter',
          targetTenantId: target,
        });
      } catch {
        throw new AppError('UNAVAILABLE', 'Audit unavailable');
      }
      entry.entered = true;
    }
    s.ctx = ctx;
    s.actAs = target;
    return next();
  };
}
