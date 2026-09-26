/**
 * @fileoverview Per-request state, shared dependencies and the middleware
 * composition used by the gateway pipeline.
 */

import type {JwtClaims} from '@ontodecide/identity/contract';
import type {
  CallCtx,
  JwtKey,
  Logger,
  UsageMeter,
  UsageStatus,
} from '@ontodecide/shared-kernel';
import type {EdgeGuardRpc} from '../edge_guard_core';
import type {Env} from '../env';
import type {MemoryRateLimiter} from '../rate_limiter';
import type {Router} from '../router';
import type {AnyRoute} from '../route_types';

/** Mutable state of one request as it moves through the chain. */
export interface GatewayState {
  request: Request;
  url: URL;
  method: string;
  /** Path below `/api/v1`. */
  path: string;
  requestId: string;
  correlationId: string;
  startedAt: number;
  ip: string;
  waitUntil(p: Promise<unknown>): void;
  route?: AnyRoute;
  params: Record<string, string>;
  claims?: JwtClaims;
  ctx?: CallCtx;
  rawBody: string;
  body: unknown;
  query: unknown;
}

/** Long-lived dependencies of the pipeline (one set per isolate/env). */
export interface GatewayDeps {
  env: Env;
  now(): number;
  logger: Logger;
  limiter: MemoryRateLimiter;
  /** Cached UsageGuard status (undefined = unknown, fail open). */
  usage: {get(ctx: CallCtx): Promise<UsageStatus | undefined>};
  meter: UsageMeter;
  router: Router<AnyRoute>;
  jwtKeys(): JwtKey[];
  edgeGuard(tenantId: string): EdgeGuardRpc;
}

/** A middleware step. */
export type Middleware = (
  s: GatewayState,
  next: () => Promise<Response>,
) => Promise<Response>;

/** Composes middleware around a terminal handler. */
export function compose(
  steps: Middleware[],
  terminal: (s: GatewayState) => Promise<Response>,
): (s: GatewayState) => Promise<Response> {
  return s => {
    const run = (i: number): Promise<Response> =>
      i < steps.length ? steps[i](s, () => run(i + 1)) : terminal(s);
    return run(0);
  };
}

/** Returns the matched route (the route-match step must have run). */
export function routeOf(s: GatewayState): AnyRoute {
  if (!s.route) throw new Error('route not matched');
  return s.route;
}
