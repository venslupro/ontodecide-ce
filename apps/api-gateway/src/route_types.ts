/**
 * @fileoverview Declarative route definition types.
 */

import type {CallCtx, Logger, Role} from '@ontodecide/shared-kernel';
import type {z} from 'zod';
import type {Env} from './env';

/** Target service of a route (`GATEWAY` = handled by the gateway itself). */
export type ServiceName =
  | 'IDENTITY'
  | 'ONTOLOGY'
  | 'INTEGRATION'
  | 'OBJECTS'
  | 'SITUATION'
  | 'DECISION'
  | 'GATEWAY';

/** Access requirement: a minimum role or a non-JWT scheme. */
export type Access = Role | 'public' | 'cookie' | 'hmac';

/** Rate limit groups. */
export type RateGroup = 'read' | 'write' | 'ingest' | 'ai' | 'auth' | 'webhook';

/** HTTP methods used by the route table. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Input passed to a route handler. */
export interface HandlerInput<B = unknown, Q = unknown> {
  /** Call context (anonymous for public / cookie / hmac routes). */
  ctx: CallCtx;
  params: Record<string, string>;
  query: Q;
  body: B;
  headers: Headers;
  rawBody: string;
  /** The original request (WebSocket forwarding). */
  request: Request;
  logger: Logger;
}

/** A route handler: returns a DTO (JSON-encoded) or a full Response. */
export type RouteHandler<B = unknown, Q = unknown> = (
  env: Env,
  input: HandlerInput<B, Q>,
) => Promise<unknown>;

/** One row of the public REST API. */
export interface RouteDef<B = unknown, Q = unknown> {
  method: HttpMethod;
  /** Path below `/api/v1`, e.g. `/sources/:id/uploads:presign`. */
  path: string;
  service: ServiceName;
  minRole: Access;
  body?: z.ZodType<B>;
  query?: z.ZodType<Q>;
  /** Honors `Idempotency-Key` (EdgeGuard replay for 24 h). */
  idempotent?: boolean;
  /** Defaults to `read` for GET and `write` otherwise. */
  rateGroup?: RateGroup;
  /** Critical writes pass the quota guard (approvals, auth). */
  critical?: boolean;
  /** Success status (default 200, or 204 when the handler returns nothing). */
  status?: number;
  /** Maximum request body in bytes (default 2 MB). */
  maxBytes?: number;
  /** Accepts `Upgrade: websocket` with `?access_token=`. */
  websocket?: boolean;
  summary: string;
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

/** Effective rate group of a route. */
export function rateGroupOf(r: AnyRoute): RateGroup {
  return r.rateGroup ?? (r.method === 'GET' ? 'read' : 'write');
}

/** Whether a route writes (subject to the quota guard and EdgeGuard). */
export function isWrite(r: AnyRoute): boolean {
  return r.method !== 'GET' && rateGroupOf(r) !== 'read';
}
