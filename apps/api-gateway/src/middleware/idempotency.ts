/**
 * @fileoverview Idempotency-Key handling: a stored 2xx response for the
 * same tenant + method + path + key is replayed (`Idempotent-Replay: true`)
 * without calling the service again. Records live 24 h in EdgeGuard.
 */

import {AppError} from '@ontodecide/shared-kernel';
import {type GatewayDeps, type Middleware, routeOf} from './chain';

const KEY_PATTERN = /^[\x21-\x7e]{1,128}$/;

/** Idempotency step. */
export function idempotency(deps: GatewayDeps): Middleware {
  return async (s, next) => {
    const route = routeOf(s);
    const key = s.request.headers.get('idempotency-key');
    const tenantId = s.ctx?.tenantId;
    if (!route.idempotent || key === null || !tenantId) return next();
    if (!KEY_PATTERN.test(key)) {
      throw new AppError('VALIDATION_FAILED', 'Invalid Idempotency-Key', {
        errors: [{path: 'Idempotency-Key', message: '1-128 visible ASCII'}],
      });
    }
    const storeKey = `${tenantId}:${s.method}:${s.url.pathname}:${key}`;
    const guard = deps.edgeGuard(tenantId);
    const count = () => {
      const flush = deps.meter.record('do.requests', 1);
      if (flush) s.waitUntil(flush);
    };

    let stored;
    try {
      count();
      stored = await guard.getIdempotent(storeKey);
    } catch (err) {
      deps.logger.warn('edge_guard.idem_get_failed', {
        requestId: s.requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (stored) {
      return new Response(stored.status === 204 ? null : stored.body, {
        status: stored.status,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'idempotent-replay': 'true',
        },
      });
    }

    const res = await next();
    if (res.status >= 200 && res.status < 300 && res.status !== 101) {
      const body = await res.clone().text();
      // Awaited so a quick retry sees the record (one DO round trip).
      try {
        count();
        await guard.putIdempotent(storeKey, res.status, body);
      } catch (err) {
        deps.logger.warn('edge_guard.idem_put_failed', {
          requestId: s.requestId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return res;
  };
}
