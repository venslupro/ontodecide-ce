/**
 * Cryptographic helpers built on the WebCrypto API available in Workers.
 *
 * - Password hashing uses PBKDF2-SHA256 with 100k iterations (no bcrypt
 *   dependency, which would require Node APIs unavailable in Workers).
 * - JWT signing uses HMAC-SHA256.
 */

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_LENGTH = 32;

/** Base64url-encode a byte array (JWT segment encoding). */
export function base64url(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i++) {
    binary += String.fromCharCode(view[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Base64url-decode a string into a byte array. */
export function base64urlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Hash a plaintext password using PBKDF2 and return `pbkdf2$iterations$salt$hash`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    TEXT_ENCODER.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    PBKDF2_KEY_LENGTH * 8,
  );
  const hash = base64url(new Uint8Array(bits));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${base64url(salt)}$${hash}`;
}

/** Verify a plaintext password against a stored `pbkdf2$...` string. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  const salt = base64urlDecode(parts[2]);
  const expected = parts[3];
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    TEXT_ENCODER.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    PBKDF2_KEY_LENGTH * 8,
  );
  return constantTimeEqual(base64url(new Uint8Array(bits)), expected);
}

/** Generate a random alphanumeric temporary password (16 chars). */
export function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** Constant-time string comparison to avoid timing leaks. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** HMAC-SHA256 sign `data` with `secret` and return base64url signature. */
export async function hmacSign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    TEXT_ENCODER.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, TEXT_ENCODER.encode(data));
  return base64url(new Uint8Array(sig));
}

/** Verify an HMAC-SHA256 signature in constant time. */
export async function hmacVerify(
  secret: string,
  data: string,
  signature: string,
): Promise<boolean> {
  const expected = await hmacSign(secret, data);
  return constantTimeEqual(expected, signature);
}

/** SHA-256 of a string, returned as hex. Used for cache keys. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', TEXT_ENCODER.encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Re-export the TextDecoder for callers that want to decode bytes. */
export function decodeBytes(bytes: Uint8Array): string {
  return TEXT_DECODER.decode(bytes);
}
