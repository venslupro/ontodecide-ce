/**
 * @fileoverview Call context carried by every service-binding RPC call.
 *
 * api-gateway builds it after verifying the access token (修订说明书 5.1).
 * Downstream services take the workspace only from `ctx.tid`; request bodies
 * never carry a tenant id.
 */

import type {Locale} from './i18n';

/**
 * Human roles (修订说明书 6): `owner` owns exactly one trial workspace;
 * `admin` is the single bootstrap administrator with the highest privilege.
 */
export const USER_ROLES = ['owner', 'admin'] as const;

/** A human role. */
export type UserRole = (typeof USER_ROLES)[number];

/** Who performs a call: a human role or an internal service principal. */
export type ActorRole = UserRole | 'service';

/** The actor behind a call. */
export interface Actor {
  role: ActorRole;
  /** User id (ULID) of a human actor. */
  userId?: string;
  /** True when an admin works inside another workspace (Act-as-Tenant). */
  actingAs: boolean;
}

/** Call context (详细设计 6.4.1). */
export interface CallCtx {
  /** Workspace id (ULID); the target workspace under Act-as. */
  tid: string;
  /** User id, or `svc:<worker>` for service principals. */
  sub: string;
  actor: Actor;
  requestId: string;
  locale: Locale;
  /**
   * Session id (`sid` claim) of the human caller's access token, set by
   * api-gateway; identity-access reads the caller's own session with it.
   */
  sid?: string;
}

/** Whether the value is a human role. */
export function isUserRole(value: unknown): value is UserRole {
  return (
    typeof value === 'string' &&
    (USER_ROLES as readonly string[]).includes(value)
  );
}

/**
 * Context for work a service does on its own behalf (cron, queue consumers,
 * decision-engine executing a confirmed recommendation).
 */
export function serviceCtx(
  tid: string,
  worker: string,
  requestId = `svc-${worker}`,
  locale: Locale = 'zh-CN',
): CallCtx {
  return {
    tid,
    sub: `svc:${worker}`,
    actor: {role: 'service', actingAs: false},
    requestId,
    locale,
  };
}

/** Whether the call comes from a service principal. */
export function isServiceCtx(ctx: CallCtx): boolean {
  return ctx.actor.role === 'service';
}

/**
 * Audit actor label for business audit rows: `owner`, `admin` (Act-as) or
 * `svc:<worker>`.
 */
export function actorLabel(ctx: CallCtx): string {
  return ctx.actor.role === 'service' ? ctx.sub : ctx.actor.role;
}

/** Header carrying a serialized CallCtx on forwarded fetches (WebSocket). */
export const CTX_HEADER = 'x-od-ctx';

/** Serializes a context for {@link CTX_HEADER}. */
export function encodeCtx(ctx: CallCtx): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(ctx))));
}

/** Parses a context produced by {@link encodeCtx}. */
export function decodeCtx(value: string): CallCtx {
  return JSON.parse(decodeURIComponent(escape(atob(value)))) as CallCtx;
}
