/**
 * @fileoverview Declarative route definition types (详细设计 6.11.7). Every
 * row of the public REST API is one {@link RouteDef}; `op` equals the
 * operationId in `openapi.yaml` (checked by a test in both directions).
 */

import type {RequestMeta} from '@ontodecide/identity/contract';
import type {
  AccessClaims,
  CallCtx,
  Clock,
  Logger,
} from '@ontodecide/shared-kernel';
import type {z} from 'zod';
import type {Env} from './env';

/** Target service of a route (`GATEWAY` = answered by the gateway). */
export type ServiceName =
  | 'IDENTITY'
  | 'ONTOLOGY'
  | 'INTEGRATION'
  | 'OBJECTS'
  | 'SITUATION'
  | 'DECISION'
  | 'GATEWAY';

/**
 * Access scope (ARCHITECTURE.md 5):
 * - `public`: no token;
 * - `refresh`: the `__Host-od_rt` cookie plus Origin;
 * - `workspace`: owner token for its workspace, or admin token for the
 *   admin workspace / the `X-Act-As-Tenant` target;
 * - `admin`: role admin with `amr` ⊇ passkey, never Act-as;
 * - `stream`: WebSocket upgrade authorized by its one-time ticket.
 */
export type Scope = 'public' | 'refresh' | 'workspace' | 'admin' | 'stream';

/** Rate classes (RL_USER_READ / RL_USER_WRITE by sub, RL_EMAIL, RL_IP_AUTH). */
export type RateClass = 'read' | 'write' | 'email' | 'ip';

/** Request headers a route requires. */
export type RequiredHeader = 'If-Match' | 'Idempotency-Key' | 'X-Step-Up';

/** HTTP methods used by the route table. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Input passed to a route handler (after the whole chain ran). */
export interface HandlerInput<B = unknown, Q = unknown> {
  /** Call context; undefined for public / refresh / stream routes. */
  ctx: CallCtx | undefined;
  /** Verified access token claims (when authenticated). */
  claims: AccessClaims | undefined;
  params: Record<string, string>;
  query: Q;
  body: B;
  /** Parsed If-Match version. */
  ifMatch?: number;
  idempotencyKey?: string;
  stepUp?: string;
  /** The original request (cookie, WebSocket forwarding). */
  request: Request;
  meta: RequestMeta;
  clock: Clock;
  logger: Logger;
}

/** A route handler. */
export type RouteHandler<B = unknown, Q = unknown> = (
  env: Env,
  input: HandlerInput<B, Q>,
) => Promise<Response>;

/** One row of the public REST API. */
export interface RouteDef<B = unknown, Q = unknown> {
  /** operationId in openapi.yaml. */
  op: string;
  method: HttpMethod;
  /** Path below `/api/v1`, OpenAPI style (`/objects/{rid}`). */
  path: string;
  service: ServiceName;
  /** Static scope, or one derived from the (unvalidated) JSON body. */
  scope: Scope | ((body: unknown) => Scope);
  /** Rate classes applied in order (empty = none). */
  rate: RateClass[];
  require?: RequiredHeader[];
  body?: z.ZodType<B>;
  query?: z.ZodType<Q>;
  /** Path parameter schemas (validated with the body). */
  params?: Record<string, z.ZodType<string>>;
  /** Owners whose trial ended may still call it (logout). */
  allowExpired?: boolean;
  /**
   * Admin scope also accepts a recovery-code session (`amr` ⊇ recovery),
   * which must bind a new passkey next.
   */
  recoveryOk?: boolean;
  /**
   * Concerns the caller's own account: X-Act-As-Tenant is ignored (logout,
   * profile, terminate code).
   */
  ownAccount?: boolean;
  /** Error responses also clear the refresh cookie. */
  clearCookieOnError?: boolean;
  handler: RouteHandler<B, Q>;
}

/** A route with erased generics, as stored in the table. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRoute = RouteDef<any, any>;

/** Declares a route with typed body / query inference. */
export function route<B = undefined, Q = Record<string, string>>(
  def: RouteDef<B, Q>,
): AnyRoute {
  return def as AnyRoute;
}

/** Whether a request method writes (Origin check, Act-as ACTIVE check). */
export function isWriteMethod(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}
