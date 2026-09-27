/**
 * @fileoverview Composition root of the gateway: the middleware chain of
 * 详细设计 6.11.7 over the declarative route table, mounted on Hono at
 * `/api/v1/*`. Imports cleanly in Node so tests drive it with fake bindings.
 */

import {
  AppError,
  CE_LIMITS,
  createLogger,
  parsePublicKeys,
  systemClock,
  type Clock,
  type Ed25519Jwk,
  type Logger,
} from '@ontodecide/shared-kernel';
import {Hono} from 'hono';
import type {Env} from './env';
import {problemResponse, withHeaders} from './http';
import {actAs} from './middleware/act_as';
import {actAsAudit} from './middleware/act_as_audit';
import {ActAsCache} from './middleware/act_as_cache';
import {adminSession, scopeCheck, verifyToken} from './middleware/authenticate';
import {bodyLimit} from './middleware/body_limit';
import {compose, type GatewayDeps, type GatewayState} from './middleware/chain';
import {dispatch} from './middleware/dispatch';
import {originCheck} from './middleware/origin';
import {problemDetails} from './middleware/problem';
import {rateLimit} from './middleware/rate_limit';
import {requestId} from './middleware/request_id';
import {requiredHeaders} from './middleware/required_headers';
import {routeMatch} from './middleware/route_match';
import {SECURITY_HEADERS, securityHeaders} from './middleware/security_headers';
import {validation} from './middleware/validation';
import {localeOf, requestMeta} from './request_meta';
import {Router} from './router';
import {ROUTES} from './routes';
import type {AnyRoute} from './route_types';

/** Public path prefix handled by the gateway. */
export const API_PREFIX = '/api/v1';

/** Test / composition overrides. */
export interface AppOverrides {
  clock?: Clock;
  logger?: Logger;
  /** Route table (defaults to {@link ROUTES}). */
  routes?: AnyRoute[];
}

/** The gateway application. */
export interface GatewayApp {
  fetch(req: Request, executionCtx?: ExecutionContext): Promise<Response>;
}

/** Builds a router over a route table. */
export function buildRouter(routes: AnyRoute[]): Router<AnyRoute> {
  const router = new Router<AnyRoute>();
  for (const r of routes) router.add(r.method, r.path, r);
  return router;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Creates the gateway app for an environment. */
export function createApp(env: Env, overrides: AppOverrides = {}): GatewayApp {
  const clock = overrides.clock ?? systemClock;
  const logger = overrides.logger ?? createLogger({service: 'api-gateway'});
  let keys: Ed25519Jwk[] | undefined;
  const deps: GatewayDeps = {
    env,
    clock,
    logger,
    router: buildRouter(overrides.routes ?? ROUTES),
    publicKeys: () => (keys ??= parsePublicKeys(env.JWT_PUBLIC_KEYS)),
    maxBodyBytes: positiveInt(env.MAX_BODY_BYTES, CE_LIMITS.maxBodyBytes),
    actAs: new ActAsCache(
      () => env.IDENTITY,
      clock,
      positiveInt(env.ACT_AS_CACHE_S, 60) * 1000,
    ),
  };

  const pipeline = compose(
    [
      requestId(deps),
      securityHeaders(),
      problemDetails(deps),
      bodyLimit(deps),
      routeMatch(deps),
      originCheck(deps),
      verifyToken(deps),
      adminSession(deps),
      scopeCheck(),
      actAs(deps),
      rateLimit(deps),
      validation(),
      requiredHeaders(),
      actAsAudit(deps),
    ],
    dispatch(deps),
  );

  const app = new Hono();
  app.all(`${API_PREFIX}/*`, c => {
    const req = c.req.raw;
    const url = new URL(req.url);
    const state: GatewayState = {
      request: req,
      url,
      method: req.method.toUpperCase(),
      path: url.pathname.slice(API_PREFIX.length) || '/',
      requestId: '',
      startedAt: clock.now().getTime(),
      ip: requestMeta(req.headers).ip,
      meta: requestMeta(req.headers),
      locale: localeOf(req.headers.get('accept-language')),
      rawBody: '',
      params: {},
      body: undefined,
      query: {},
    };
    return pipeline(state);
  });
  app.notFound(() =>
    withHeaders(problemResponse(new AppError('NOT_FOUND')), {
      ...SECURITY_HEADERS,
    }),
  );
  app.onError((err, c) => {
    logger.error('unhandled', {error: err.message, path: c.req.path});
    return withHeaders(problemResponse(err), {...SECURITY_HEADERS});
  });

  return {
    fetch: async (req, executionCtx) =>
      executionCtx ? app.fetch(req, undefined, executionCtx) : app.fetch(req),
  };
}
