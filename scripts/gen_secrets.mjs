#!/usr/bin/env node
/**
 * @fileoverview Generates the identity-access secrets that no provider
 * creates (详细设计 6.8 配置项):
 *
 *   JWT_SIGNING_KEY             Ed25519 private JWK, kid = yyyy-mm
 *   EMAIL_PEPPER                HMAC key for e-mail / IP hashes
 *   EMAIL_ENC_KEY               AES-GCM key for stored e-mail addresses
 *   BOOTSTRAP_ADMIN_SETUP_CODE  one-time code binding the first passkey
 *
 * Usage:
 *   node scripts/gen_secrets.mjs [--kid 2026-10] [--only JWT_SIGNING_KEY]
 *
 * Prints KEY=value lines; paste them into GitHub → Settings → Secrets and
 * variables → Actions. Nothing is written to disk.
 *
 * JWT key rotation: generate a new JWT_SIGNING_KEY, move the old value to
 * JWT_SIGNING_KEY_PREV and deploy (api-gateway then accepts both kids);
 * remove JWT_SIGNING_KEY_PREV (and deploy again) once every access token
 * signed with the old key has expired.
 * EMAIL_PEPPER and EMAIL_ENC_KEY must never change after the first deploy
 * (stored hashes and ciphertexts depend on them).
 */

import {generateKeyPairSync, randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';

/** Crockford base32 alphabet (no I, L, O, U) for human-typed codes. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Returns the current UTC month as yyyy-mm (the default key id). */
export function monthKid(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

/**
 * Returns a new Ed25519 private JWK `{kty, crv, x, d, kid}`.
 * @param {string} kid Key id.
 */
export function newSigningJwk(kid) {
  const {privateKey} = generateKeyPairSync('ed25519');
  const jwk = privateKey.export({format: 'jwk'});
  return {kty: 'OKP', crv: 'Ed25519', x: jwk.x, d: jwk.d, kid};
}

/**
 * Returns the public JWK set `{"keys": [...]}` for private JWK JSON strings
 * (empty / undefined entries are skipped; duplicate kids are rejected).
 * @param {Array<string | undefined>} rawKeys
 */
export function publicJwkSet(rawKeys) {
  const keys = [];
  for (const raw of rawKeys) {
    if (!raw) continue;
    let jwk;
    try {
      jwk = JSON.parse(raw);
    } catch {
      throw new Error('JWT signing key is not valid JSON');
    }
    if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || !jwk.x || !jwk.kid) {
      throw new Error('JWT signing key must be an Ed25519 JWK with x and kid');
    }
    if (keys.some(k => k.kid === jwk.kid)) {
      throw new Error(`Duplicate JWT key id ${jwk.kid}`);
    }
    keys.push({kty: 'OKP', crv: 'Ed25519', x: jwk.x, kid: jwk.kid});
  }
  return {keys};
}

/** Returns a random base64url secret of n bytes. */
export function randomSecret(n = 32) {
  return randomBytes(n).toString('base64url');
}

/** Returns a setup code like `7K2Q-M9XD-4RTA-B3HV` (80 bits). */
export function setupCode() {
  const bytes = randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) {
    if (i > 0 && i % 4 === 0) out += '-';
    out += CROCKFORD[bytes[i] & 31];
  }
  return out;
}

/**
 * Returns every generated secret.
 * @param {string} kid JWT key id.
 */
export function generateSecrets(kid = monthKid()) {
  return {
    JWT_SIGNING_KEY: JSON.stringify(newSigningJwk(kid)),
    EMAIL_PEPPER: randomSecret(),
    EMAIL_ENC_KEY: randomSecret(),
    BOOTSTRAP_ADMIN_SETUP_CODE: setupCode(),
  };
}

function main() {
  const argv = process.argv.slice(2);
  let kid = monthKid();
  let only;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--kid') kid = argv[++i];
    else if (argv[i] === '--only') only = argv[++i];
    else throw new Error(`Unknown argument ${argv[i]}`);
  }
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(kid ?? '')) {
    throw new Error('--kid must be 1-32 characters [A-Za-z0-9._-]');
  }
  const secrets = generateSecrets(kid);
  for (const [k, v] of Object.entries(secrets)) {
    if (!only || only === k) console.log(`${k}=${v}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
