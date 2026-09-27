/**
 * @fileoverview Ed25519 (EdDSA) JWTs with key ids (详细设计 6.11.6).
 *
 * identity-access holds the private key (Worker secret JWT_SIGNING_KEY, a
 * JWK with `kid`) and signs; api-gateway holds only the public JWK set
 * (JWT_PUBLIC_KEYS) and verifies. During rotation the gateway accepts both
 * the old and the new public key.
 */

import {base64url, base64urlDecode, fromUtf8, utf8} from './crypto';
import {AppError} from './errors';
import type {UserRole} from './call_ctx';

/** Workspace lifecycle state (详细设计 6.2). */
export type WorkspaceStatus = 'ACTIVE' | 'EXPIRED' | 'ARCHIVING';

/** Authentication methods recorded in `amr`. */
export type AuthMethod = 'otp' | 'passkey' | 'recovery';

/** Claims of an access token. Times are Unix seconds. */
export interface AccessClaims {
  sub: string;
  role: UserRole;
  tid: string;
  st: WorkspaceStatus;
  /** Trial end; absent for the admin. */
  texp?: number;
  sid: string;
  amr: AuthMethod[];
  iat: number;
  exp: number;
}

/** An Ed25519 JWK (private when `d` is present). */
export interface Ed25519Jwk {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
  d?: string;
  kid: string;
}

const ALG = {name: 'Ed25519'} as const;

function encodeSegment(value: unknown): string {
  return base64url(utf8(JSON.stringify(value)));
}

/** Parses the JWT_SIGNING_KEY secret (a private Ed25519 JWK with kid). */
export function parseSigningKey(raw: string | undefined): Ed25519Jwk {
  if (!raw) throw new AppError('INTERNAL', 'JWT_SIGNING_KEY is not set');
  const jwk = JSON.parse(raw) as Ed25519Jwk;
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || !jwk.d || !jwk.kid) {
    throw new AppError('INTERNAL', 'JWT_SIGNING_KEY is not an Ed25519 JWK');
  }
  return jwk;
}

/**
 * Parses the JWT_PUBLIC_KEYS var: `{"keys": [jwk, ...]}` or a bare array.
 * Private members are dropped.
 */
export function parsePublicKeys(raw: string | undefined): Ed25519Jwk[] {
  if (!raw) throw new AppError('INTERNAL', 'JWT_PUBLIC_KEYS is not set');
  const parsed = JSON.parse(raw) as {keys?: Ed25519Jwk[]} | Ed25519Jwk[];
  const keys = Array.isArray(parsed) ? parsed : (parsed.keys ?? []);
  if (keys.length === 0) {
    throw new AppError('INTERNAL', 'JWT_PUBLIC_KEYS is empty');
  }
  return keys.map(publicJwkOf);
}

/** Returns the public part of an Ed25519 JWK. */
export function publicJwkOf(jwk: Ed25519Jwk): Ed25519Jwk {
  return {kty: 'OKP', crv: 'Ed25519', x: jwk.x, kid: jwk.kid};
}

/** Generates a new Ed25519 private JWK (scripts and tests). */
export async function generateSigningKey(kid: string): Promise<Ed25519Jwk> {
  const pair = (await crypto.subtle.generateKey(ALG, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey(
    'jwk',
    pair.privateKey,
  )) as JsonWebKey;
  return {kty: 'OKP', crv: 'Ed25519', x: jwk.x!, d: jwk.d!, kid};
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function importKey(jwk: Ed25519Jwk, usage: 'sign' | 'verify') {
  const cacheKey = `${usage}:${jwk.kid}:${jwk.x}`;
  let key = keyCache.get(cacheKey);
  if (!key) {
    const material: JsonWebKey = {kty: 'OKP', crv: 'Ed25519', x: jwk.x};
    if (usage === 'sign') material.d = jwk.d;
    key = crypto.subtle.importKey('jwk', material, ALG, false, [usage]);
    keyCache.set(cacheKey, key);
  }
  return key;
}

/** Signs claims with an Ed25519 private JWK. */
export async function signJwt(
  claims: object,
  key: Ed25519Jwk,
): Promise<string> {
  const head = encodeSegment({alg: 'EdDSA', typ: 'JWT', kid: key.kid});
  const body = encodeSegment(claims);
  const sig = await crypto.subtle.sign(
    ALG,
    await importKey(key, 'sign'),
    utf8(`${head}.${body}`),
  );
  return `${head}.${body}.${base64url(sig)}`;
}

/**
 * Verifies a token against a public JWK set and returns its claims.
 * Throws UNAUTHENTICATED for malformed, unsigned, unknown-kid or expired
 * tokens.
 */
export async function verifyJwt<T extends {exp?: number}>(
  token: string,
  keys: readonly Ed25519Jwk[],
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<T> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new AppError('UNAUTHENTICATED', 'Malformed token');
  }
  let header: {alg?: string; kid?: string};
  let claims: T;
  try {
    header = JSON.parse(fromUtf8(base64urlDecode(parts[0])));
    claims = JSON.parse(fromUtf8(base64urlDecode(parts[1])));
  } catch {
    throw new AppError('UNAUTHENTICATED', 'Malformed token');
  }
  if (header.alg !== 'EdDSA') {
    throw new AppError('UNAUTHENTICATED', 'Unsupported algorithm');
  }
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) throw new AppError('UNAUTHENTICATED', 'Unknown key id');
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      ALG,
      await importKey(jwk, 'verify'),
      base64urlDecode(parts[2]),
      utf8(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    valid = false;
  }
  if (!valid) throw new AppError('UNAUTHENTICATED', 'Bad signature');
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) {
    throw new AppError('UNAUTHENTICATED', 'Token has no expiry');
  }
  if (claims.exp <= nowSec) {
    throw new AppError('UNAUTHENTICATED', 'Token expired');
  }
  return claims;
}
