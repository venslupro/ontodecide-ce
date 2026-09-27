/**
 * @fileoverview Origin check (修订说明书 12.4): every non-GET request, the
 * refresh endpoint and the WebSocket upgrade must come from APP_ORIGIN
 * (403 FORBIDDEN otherwise). Same-origin browsers always send Origin on
 * these requests, so a missing header is rejected as well.
 */

import {AppError} from '@ontodecide/shared-kernel';
import {isWriteMethod} from '../route_types';
import type {GatewayDeps, Middleware} from './chain';

/** Whether the request's Origin equals the app origin. */
export function originAllowed(req: Request, appOrigin: string): boolean {
  const origin = req.headers.get('origin');
  return !!origin && !!appOrigin && origin === appOrigin.replace(/\/+$/, '');
}

/** Origin step. */
export function originCheck(deps: GatewayDeps): Middleware {
  return async (s, next) => {
    const needed =
      isWriteMethod(s.method) || s.scope === 'refresh' || s.scope === 'stream';
    if (needed && !originAllowed(s.request, deps.env.APP_ORIGIN)) {
      throw new AppError('FORBIDDEN', 'Origin not allowed');
    }
    return next();
  };
}
