/**
 * @fileoverview HTTP conventions shared by api-gateway and the web app
 * (修订说明书 10.1).
 */

/** Admin Act-as-Tenant request header. */
export const ACT_AS_HEADER = 'X-Act-As-Tenant';

/** Passkey step-up proof header for high-risk admin writes. */
export const STEP_UP_HEADER = 'X-Step-Up';

/** Idempotency key request header. */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/** Name of the refresh-token cookie (HttpOnly, Secure, SameSite=Strict). */
export const REFRESH_COOKIE = '__Host-od_rt';

/** Formats a version number as an ETag (`"v3"`). */
export function toEtag(version: number | string): string {
  return `"v${version}"`;
}

/**
 * Parses an ETag / If-Match value (`"v3"`, `W/"v3"`, `v3` or `3`) into a
 * version number; null when malformed.
 */
export function parseEtag(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(?:W\/)?"?v?(\d+)"?$/.exec(value.trim());
  return m ? Number(m[1]) : null;
}

/** Whether an Idempotency-Key has an acceptable shape (16–64 chars). */
export function isIdempotencyKey(value: string | null | undefined): boolean {
  return !!value && /^[A-Za-z0-9._:-]{16,64}$/.test(value);
}
