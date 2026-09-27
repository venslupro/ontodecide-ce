/**
 * @fileoverview Per-request state, shared dependencies and the middleware
 * composition of the gateway pipeline.
 */

import type {RequestMeta} from '@ontodecide/identity/contract';
import type {
  AccessClaims,
  CallCtx,
  Clock,
  Ed25519Jwk,
  Locale,
  Logger,
} from '@ontodecide/shared-kernel';
import type {ActAsCache} from './act_as_cache';
import type {Env} from '../env';
import type {Router} from '../router';
import type {AnyRoute, Scope} from '../route_types';

/** Mutable state of one request as it moves through the chain. */
export interface GatewayState {
  request: Request;
  url: URL;
  method: string;
  /** Path below `/api/v1`. */
  path: string;
  requestId: string;
  startedAt: number;
  ip: string;
  meta: RequestMeta;
  locale: Locale;
  /** Raw request body (empty for GET). */
  rawBody: string;
  route?: AnyRoute;
  scope?: Scope;
  params: Record<string, string>;
  claims?: AccessClaims;
  ctx?: CallCtx;
  /** Act-as target tenant when an admin sent X-Act-As-Tenant. */
  actAs?: string;
  body: unknown;
  query: unknown;
  ifMatch?: number;
  idempotencyKey?: string;
  stepUp?: string;
}

/** Long-lived dependencies of the pipeline (one set per isolate / env). */
export interface GatewayDeps {
  env: Env;
  clock: Clock;
  logger: Logger;
  router: Router<AnyRoute>;
  publicKeys(): Ed25519Jwk[];
  maxBodyBytes: number;
  actAs: ActAsCache;
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
