/**
 * Lightweight input validators used by service handlers.
 *
 * These intentionally avoid a runtime-schema dependency; if stronger
 * validation is needed later, swap the bodies for zod calls.
 */

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TENANT_RE = /^tenant_[a-f0-9]{8,16}$/;

/** True when `value` looks like a valid username. */
export function isValidUsername(value: unknown): value is string {
  return typeof value === 'string' && USERNAME_RE.test(value);
}

/** True when `value` looks like a valid email. */
export function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && EMAIL_RE.test(value);
}

/** True when `value` looks like a tenant id produced by `tenantId()`. */
export function isValidTenantId(value: unknown): value is string {
  return typeof value === 'string' && TENANT_RE.test(value);
}

/** True when `value` is a non-empty string after trimming. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Clamp a numeric value to `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
