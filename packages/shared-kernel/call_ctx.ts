/**
 * @fileoverview Call context propagated with every RPC call and queue
 * message. Built by api-gateway after the JWT has been verified.
 */

/** Platform roles, from least to most privileged. */
export const ROLES = ['Viewer', 'Operator', 'Modeler', 'Admin'] as const;

/** A platform role. */
export type Role = (typeof ROLES)[number];

/** Call context carried by every RPC call and queue message. */
export interface CallCtx {
  tenantId: string;
  userId: string;
  roles: Role[];
  markings: string[];
  requestId: string;
  correlationId: string;
  locale?: string;
}

/** Returns the rank of a role; higher means more privileged. */
export function roleRank(role: Role): number {
  return ROLES.indexOf(role);
}

/** Whether any of the given roles satisfies the minimum role. */
export function hasRole(roles: readonly Role[], minRole: Role): boolean {
  const min = roleRank(minRole);
  return roles.some(r => roleRank(r) >= min);
}

/** Whether the value is a known role. */
export function isRole(value: unknown): value is Role {
  return (
    typeof value === 'string' && (ROLES as readonly string[]).includes(value)
  );
}

/**
 * Builds a context for system-initiated work (cron, queue consumers). The
 * system user holds the Admin role and every marking is bypassed by callers
 * that check {@link isSystemCtx}.
 */
export function systemCtx(tenantId: string, correlationId = 'system'): CallCtx {
  return {
    tenantId,
    userId: SYSTEM_USER_ID,
    roles: ['Admin'],
    markings: ['*'],
    requestId: correlationId,
    correlationId,
  };
}

/** User id used for system-initiated calls. */
export const SYSTEM_USER_ID = 'system';

/** Whether the context was built by {@link systemCtx}. */
export function isSystemCtx(ctx: CallCtx): boolean {
  return ctx.userId === SYSTEM_USER_ID;
}

/** Whether the caller holds the given marking. */
export function hasMarking(ctx: CallCtx, marking: string): boolean {
  return ctx.markings.includes('*') || ctx.markings.includes(marking);
}

/** Header used to forward a serialized CallCtx over service-binding fetch. */
export const CTX_HEADER = 'x-od-ctx';

/** Serializes a context for {@link CTX_HEADER}. */
export function encodeCtx(ctx: CallCtx): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(ctx))));
}

/** Parses a context produced by {@link encodeCtx}. */
export function decodeCtx(value: string): CallCtx {
  return JSON.parse(decodeURIComponent(escape(atob(value)))) as CallCtx;
}
