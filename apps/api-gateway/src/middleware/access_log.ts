/**
 * @fileoverview One JSON log line per request (2xx GETs sampled 1:10,
 * errors and writes always) and usage metering (`workers.requests` += 3:
 * Pages Function + gateway + service).
 */

import type {GatewayDeps, Middleware} from './chain';

/** Invocations billed per API request. */
export const REQUESTS_PER_API_CALL = 3;
const SAMPLE_EVERY = 10;

/** Access log + usage metering step. */
export function accessLog(deps: GatewayDeps): Middleware {
  let readCounter = 0;
  return async (s, next) => {
    let status = 500;
    try {
      const res = await next();
      status = res.status;
      return res;
    } finally {
      const durationMs = deps.now() - s.startedAt;
      const isRead = s.method === 'GET' || s.method === 'HEAD';
      const sampled =
        status >= 400 || !isRead || readCounter++ % SAMPLE_EVERY === 0;
      if (sampled) {
        const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
        deps.logger.log(level, 'request', {
          requestId: s.requestId,
          correlationId: s.correlationId,
          tenantId: s.ctx?.tenantId || undefined,
          route: s.route
            ? `${s.route.method} ${s.route.path}`
            : `${s.method} ${s.path}`,
          status,
          durationMs,
        });
      }
      const flush = deps.meter.record(
        'workers.requests',
        REQUESTS_PER_API_CALL,
      );
      if (flush) s.waitUntil(flush);
    }
  };
}
