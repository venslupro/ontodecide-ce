/**
 * @fileoverview HS256 JWT signing and verification with key ids (kid) for
 * rotation. identity-access signs; api-gateway verifies locally.
 */

import {
  base64url,
  base64urlDecode,
  constantTimeEqual,
  fromUtf8,
  hmacSha256B64,
  utf8,
} from './crypto';
import {AppError} from './errors';

/** A signing key. */
export interface JwtKey {
  kid: string;
  secret: string;
}

/**
 * Parses `JWT_SECRET`. Either a bare secret (kid `k1`) or a comma separated
 * list `kid:secret,kid2:secret2`; the first entry signs, all verify.
 */
export function parseJwtKeys(raw: string | undefined): JwtKey[] {
  if (!raw) throw new AppError('INTERNAL', 'JWT_SECRET is not configured');
  return raw.split(',').map((part, i) => {
    const idx = part.indexOf(':');
    return idx > 0
      ? {kid: part.slice(0, idx).trim(), secret: part.slice(idx + 1).trim()}
      : {kid: i === 0 ? 'k1' : `k${i + 1}`, secret: part.trim()};
  });
}

function encodeSegment(value: unknown): string {
  return base64url(utf8(JSON.stringify(value)));
}

/** Signs claims with the first key. */
export async function signJwt(
  claims: Record<string, unknown>,
  keys: JwtKey[],
): Promise<string> {
  const key = keys[0];
  const head = encodeSegment({alg: 'HS256', typ: 'JWT', kid: key.kid});
  const body = encodeSegment(claims);
  const sig = await hmacSha256B64(key.secret, `${head}.${body}`);
  return `${head}.${body}.${sig}`;
}

/**
 * Verifies a token and returns its claims. Throws AUTH_INVALID for bad
 * tokens and AUTH_EXPIRED for expired ones.
 */
export async function verifyJwt<T extends {exp?: number}>(
  token: string,
  keys: JwtKey[],
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<T> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new AppError('AUTH_INVALID', 'Malformed token');
  let header: {alg?: string; kid?: string};
  let claims: T;
  try {
    header = JSON.parse(fromUtf8(base64urlDecode(parts[0])));
    claims = JSON.parse(fromUtf8(base64urlDecode(parts[1])));
  } catch {
    throw new AppError('AUTH_INVALID', 'Malformed token');
  }
  if (header.alg !== 'HS256')
    throw new AppError('AUTH_INVALID', 'Unsupported algorithm');
  const key =
    keys.find(k => k.kid === header.kid) ?? (header.kid ? undefined : keys[0]);
  if (!key) throw new AppError('AUTH_INVALID', 'Unknown key id');
  const expected = await hmacSha256B64(key.secret, `${parts[0]}.${parts[1]}`);
  if (!constantTimeEqual(expected, parts[2]))
    throw new AppError('AUTH_INVALID', 'Bad signature');
  if (typeof claims.exp === 'number' && claims.exp <= nowSec) {
    throw new AppError('AUTH_EXPIRED', 'Token expired');
  }
  return claims;
}
