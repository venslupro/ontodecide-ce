/**
 * @fileoverview Composition root of the gateway: builds the middleware
 * chain over the route table and mounts it on Hono at `/api/v1/*`.
 * Imports cleanly in Node so tests can drive it with fake bindings.
 */

import {
  AppError,
  createLogger,
  parseJwtKeys,
  UsageMeter,
  type Clock,
  type JwtKey,
  type Logger,
} from '@ontodecide/shared-kernel';
import {Hono} from 'hono';
import type {EdgeGuardRpc} from './edge_guard_core';
import type {Env} from './env';
import {problemResponse, withHeaders} from './http';
import {accessLog} from './middleware/access_log';
import {callCtx} from './middleware/call_ctx';
import {compose, type GatewayDeps, type GatewayState} from './middleware/chain';
import {dispatch} from './middleware/dispatch';
import {idempotency} from './middleware/idempotency';
import {jwtAuth} from './middleware/jwt_auth';
import {problemDetails} from './middleware/problem';
import {rateLimit} from './middleware/rate_limit';
import {rbac} from './middleware/rbac';
import {requestId} from './middleware/request_id';
import {routeMatch} from './middleware/route_match';
import {SECURITY_HEADERS, securityHeaders} from './middleware/security_headers';
import {UsageGuardCache, usageGuard} from './middleware/usage_guard';
import {validation} from './middleware/validation';
import {MemoryRateLimiter} from './rate_limiter';
import {Router} from './router';
import {ROUTES} from './routes';
import type {AnyRoute} from './route_types';

/** Public path prefix handled by the gateway. */
export const API_PREFIX = '/api/v1';

/** Test / composition overrides. */
export interface AppOverrides {
  clock?: Clock;
  logger?: Logger;
  now?: () => number;
  /** Route table (defaults to {@link ROUTES}). */
  routes?: AnyRoute[];
}

/** The gateway application. */
export interface GatewayApp {
  fetch(req: Request, executionCtx?: ExecutionContext): Promise<Response>;
  /** Flushes pending usage counts (tests / shutdown). */
  flushUsage(): Promise<void>;
}

/** Builds a router over a route table. */
export function buildRouter(routes: AnyRoute[]): Router<AnyRoute> {
  const router = new Router<AnyRoute>();
  for (const r of routes) router.add(r.method, r.path, r);
  return router;
}

/** Creates the gateway app for an environment. */
export function createApp(env: Env, overrides: AppOverrides = {}): GatewayApp {
  const clock = overrides.clock;
  const now =
    overrides.now ?? (clock ? () => clock.now().getTime() : () => Date.now());
  const logger = overrides.logger ?? createLogger({service: 'api-gateway'});
  const usage = new UsageGuardCache(env, now);
  const meter = new UsageMeter(
    async batch => {
      const status = await env.SITUATION.recordUsage(batch);
      if (status && typeof status === 'object' && 'level' in status) {
        usage.set(status);
      }
    },
    100,
    30_000,
    now,
  );
  let keys: JwtKey[] | undefined;
  const deps: GatewayDeps = {
    env,
    now,
    logger,
    limiter: new MemoryRateLimiter(),
    usage,
    meter,
    router: buildRouter(overrides.routes ?? ROUTES),
    jwtKeys: () => (keys ??= parseJwtKeys(env.JWT_SECRET)),
    edgeGuard: tenantId =>
      env.EDGE_GUARD.get(
        env.EDGE_GUARD.idFromName(tenantId),
      ) as unknown as EdgeGuardRpc,
  };

  // Order per design: requestId → security headers → jwtAuth → CallCtx →
  // RBAC → rate limit → quota guard → idempotency → zod → dispatch, with
  // Problem Details mapping everything thrown after the headers step.
  const pipeline = compose(
    [
      requestId(deps),
      accessLog(deps),
      securityHeaders(),
      problemDetails(deps),
      routeMatch(deps),
      jwtAuth(deps),
      callCtx(),
      rbac(),
      rateLimit(deps),
      usageGuard(deps),
      idempotency(deps),
      validation(),
    ],
    dispatch(deps),
  );

  const app = new Hono();
  app.all(`${API_PREFIX}/*`, c => {
    let execCtx: ExecutionContext | undefined;
    try {
      execCtx = c.executionCtx as ExecutionContext;
    } catch {
      execCtx = undefined;
    }
    const req = c.req.raw;
    const url = new URL(req.url);
    const state: GatewayState = {
      request: req,
      url,
      method: req.method.toUpperCase(),
      path: url.pathname.slice(API_PREFIX.length) || '/',
      requestId: '',
      correlationId: '',
      startedAt: now(),
      ip:
        req.headers.get('cf-connecting-ip') ??
        req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
        'unknown',
      waitUntil: p => {
        const safe = p.catch(() => undefined);
        if (execCtx) execCtx.waitUntil(safe);
      },
      params: {},
      rawBody: '',
      body: undefined,
      query: {},
    };
    return pipeline(state);
  });
  app.notFound(() =>
    withHeaders(problemResponse(new AppError('NOT_FOUND')), SECURITY_HEADERS),
  );
  app.onError((err, c) => {
    logger.error('unhandled', {error: err.message, path: c.req.path});
    return withHeaders(problemResponse(err), SECURITY_HEADERS);
  });

  return {
    fetch: async (req, executionCtx) =>
      executionCtx ? app.fetch(req, undefined, executionCtx) : app.fetch(req),
    flushUsage: () => meter.flush(),
  };
}
