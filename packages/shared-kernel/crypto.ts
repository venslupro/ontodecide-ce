/**
 * @fileoverview WebCrypto helpers available in Workers and Node ≥ 22.
 */

const ENC = new TextEncoder();
const DEC = new TextDecoder();

/** Base64url-encodes bytes. */
export function base64url(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Decodes base64url into bytes. */
export function base64urlDecode(input: string): Uint8Array<ArrayBuffer> {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** UTF-8 encodes a string. */
export function utf8(s: string): Uint8Array<ArrayBuffer> {
  return ENC.encode(s) as Uint8Array<ArrayBuffer>;
}

/** UTF-8 decodes bytes. */
export function fromUtf8(b: Uint8Array | ArrayBuffer): string {
  return DEC.decode(b);
}

/** Hex encodes bytes. */
export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(view, b => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 of a string, hex encoded. */
export async function sha256Hex(input: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', utf8(input)));
}

async function hmacKey(
  secret: string,
  usage: ('sign' | 'verify')[],
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    utf8(secret),
    {name: 'HMAC', hash: 'SHA-256'},
    false,
    usage,
  );
}

/** HMAC-SHA256, hex encoded. */
export async function hmacSha256Hex(
  secret: string,
  data: string,
): Promise<string> {
  const key = await hmacKey(secret, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, utf8(data)));
}

/** HMAC-SHA256, base64url encoded. */
export async function hmacSha256B64(
  secret: string,
  data: string,
): Promise<string> {
  const key = await hmacKey(secret, ['sign']);
  return base64url(await crypto.subtle.sign('HMAC', key, utf8(data)));
}

/** Constant-time string comparison. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** PBKDF2-SHA256 iteration count (detailed design: 100k). */
export const PBKDF2_ITERATIONS = 100_000;

/** Derives a PBKDF2-SHA256 hash (base64url) from a password and salt. */
export async function pbkdf2(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations = PBKDF2_ITERATIONS,
): Promise<string> {
  const material = await crypto.subtle.importKey(
    'raw',
    utf8(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {name: 'PBKDF2', salt, iterations, hash: 'SHA-256'},
    material,
    256,
  );
  return base64url(bits);
}

/** Returns n random bytes. */
export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** Returns a random base64url token of n bytes. */
export function randomToken(n = 32): string {
  return base64url(randomBytes(n));
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', utf8(secret));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

/** AES-GCM encrypts plaintext; returns `iv.ciphertext` (base64url). */
export async function aesGcmEncrypt(
  secret: string,
  plaintext: string,
): Promise<string> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    {name: 'AES-GCM', iv},
    await aesKey(secret),
    utf8(plaintext),
  );
  return `${base64url(iv)}.${base64url(ct)}`;
}

/** Decrypts a value produced by {@link aesGcmEncrypt}. */
export async function aesGcmDecrypt(
  secret: string,
  sealed: string,
): Promise<string> {
  const [iv, ct] = sealed.split('.');
  const pt = await crypto.subtle.decrypt(
    {name: 'AES-GCM', iv: base64urlDecode(iv)},
    await aesKey(secret),
    base64urlDecode(ct),
  );
  return fromUtf8(pt);
}
