/**
 * JWT token helpers.
 *
 * Provides a safe base64url decoder that extracts the JSON payload from a
 * compact JWT and returns it cast to the caller-supplied type. Malformed
 * tokens throw a descriptive error so the UI surface can surface them.
 */

/**
 * Decodes the base64url-encoded payload segment of a JWT and returns it
 * cast to {@code T}.
 *
 * @param token Compact JWT string of the form "header.payload.signature".
 * @returns The decoded JSON payload cast to {@code T}.
 * @throws Error If the token is missing, cannot be split, or has malformed
 *     base64url / JSON content.
 */
export function parseJwtPayload<T>(token: string): T {
  if (!token || typeof token !== 'string') {
    throw new Error('JWT decode failed: empty token.');
  }
  const parts = token.split('.');
  if (parts.length < 2) {
    throw new Error('JWT decode failed: expected compact JWT format.');
  }
  const payloadSegment = parts[1] ?? '';
  const decoded = base64UrlDecode(payloadSegment);
  try {
    return JSON.parse(decoded) as T;
  } catch {
    throw new Error('JWT decode failed: payload is not valid JSON.');
  }
}

/**
 * Converts a base64url encoded string to a UTF-8 string.
 *
 * @param input Base64url encoded payload.
 * @returns Decoded UTF-8 string.
 * @throws Error If the input contains characters outside the base64url
 *     alphabet once padding has been applied.
 */
function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLength);
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('JWT decode failed: invalid base64url payload.');
  }
}
