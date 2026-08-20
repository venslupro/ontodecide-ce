/**
 * Id generation helpers.
 *
 * Uses the WebCrypto `crypto.randomUUID()` available in Workers; falls back
 * to a UUIDv4 implementation built on `crypto.getRandomValues` so the helper
 * also works in non-Worker unit tests where `randomUUID` may be absent.
 */

/** Generate a new UUID v4 string. */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return uuidFallback();
}

/**
 * Generate a tenant id with a stable `tenant_` prefix.
 * @param prefix Optional prefix, defaults to 'tenant'.
 */
export function tenantId(prefix = 'tenant'): string {
  return `${prefix}_${uuid().replace(/-/g, '').slice(0, 12)}`;
}

/** Generate a short, URL-safe job id (useful for queue tasks). */
export function jobId(): string {
  return uuid().replace(/-/g, '').slice(0, 16);
}

/** Fallback UUID v4 generator based on RFC 4122. */
function uuidFallback(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Per RFC 4122 §4.4 set version and variant bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return (
    `${hex.slice(0, 4).join('')}-` +
    `${hex.slice(4, 6).join('')}-` +
    `${hex.slice(6, 8).join('')}-` +
    `${hex.slice(8, 10).join('')}-` +
    `${hex.slice(10, 16).join('')}`
  );
}
