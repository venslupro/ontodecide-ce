/**
 * JWT sign / verify helpers built on WebCrypto HMAC-SHA256.
 *
 * Implementation notes:
 * - Header is fixed to `{"alg":"HS256","typ":"JWT"}`.
 * - Verification checks signature, expiry, and (optionally) a KV-backed
 *   blacklist of revoked `jti` claims.
 */
import type {JwtPayload} from '../types/user.js';
import {base64url, base64urlDecode, hmacSign, hmacVerify} from './crypto.js';

const JWT_HEADER = {alg: 'HS256', typ: 'JWT'};

/** Encode a value as base64url(JSON.stringify(value)). */
function encodeSegment(value: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

/** Decode a base64url segment into the typed object. */
function decodeSegment<T>(segment: string): T {
  const bytes = base64urlDecode(segment);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

/**
 * Sign a payload and return a compact JWT.
 * @param secret HMAC secret shared with downstream services.
 */
export async function signJwt(
    payload: Omit<JwtPayload, 'iat'>,
    secret: string,
    issuedAt = Math.floor(Date.now() / 1000),
): Promise<string> {
  const fullPayload: JwtPayload = {...payload, iat: issuedAt};
  const headerSegment = encodeSegment(JWT_HEADER);
  const payloadSegment = encodeSegment(fullPayload);
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const signature = await hmacSign(secret, signingInput);
  return `${signingInput}.${signature}`;
}

/**
 * Verify a JWT and return the payload, or `null` if invalid/expired.
 * @param blacklistFn Optional async function returning `true` if the jti is revoked.
 */
export async function verifyJwt(
    token: string,
    secret: string,
    blacklistFn?: (jti: string) => Promise<boolean>,
): Promise<JwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerSeg, payloadSeg, signature] = parts as [
    string,
    string,
    string,
  ];
  const signingInput = `${headerSeg}.${payloadSeg}`;
  const valid = await hmacVerify(secret, signingInput, signature);
  if (!valid) return null;
  let header: unknown;
  let payload: JwtPayload;
  try {
    header = decodeSegment(headerSeg);
    payload = decodeSegment<JwtPayload>(payloadSeg);
  } catch {
    return null;
  }
  if (!isHeader(header)) return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
  if (blacklistFn && payload.jti) {
    const revoked = await blacklistFn(payload.jti);
    if (revoked) return null;
  }
  return payload;
}

function isHeader(value: unknown): value is {alg: string; typ: string} {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as {alg?: unknown}).alg === 'HS256' &&
    (value as {typ?: unknown}).typ === 'JWT'
  );
}
