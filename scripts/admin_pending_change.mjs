#!/usr/bin/env node
/**
 * @fileoverview Controlled change of the bootstrap admin (修订说明书 6.4 /
 * docs/ROLES.md "Controlled changes"): inserts one `admin_pending_change`
 * row into identity-access-db. The identity-access cron then e-mails the
 * CURRENT admin address and applies the change after the 24-hour cool-down
 * (all admin sessions revoked; a passkey reset deletes every passkey and
 * the recovery codes and re-enables BOOTSTRAP_ADMIN_SETUP_CODE).
 *
 *   node scripts/admin_pending_change.mjs --kind email --email new@example.com
 *   node scripts/admin_pending_change.mjs --kind passkey_reset
 *
 * Options:
 *   --kind email|passkey_reset   what to change (required)
 *   --email ADDRESS              the new admin address (kind email)
 *   --delay-hours N              hours until the change applies (default and
 *                                minimum 24)
 *   -c, --config PATH            wrangler config of identity-access
 *                                (default apps/identity-access/wrangler.jsonc)
 *   --local [--persist-to DIR]   the `wrangler dev` database instead of --remote
 *   --dry-run                    print the SQL only (nothing is executed)
 *
 * The new e-mail is never written in clear: it is normalized (trim, lower
 * case) and sealed like every stored address, AES-GCM with a key derived as
 * SHA-256(EMAIL_ENC_KEY), `base64url(iv).base64url(ciphertext)`, stored as
 * `{"emailEnc": "..."}`. EMAIL_ENC_KEY must be in the environment (the same
 * secret identity-access uses; see scripts/gen_secrets.mjs). The payload is
 * cleared when the change is applied. Nothing is logged except the row id.
 */

import {Buffer} from 'node:buffer';
import {execFileSync} from 'node:child_process';
import {randomBytes, webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TextEncoder} from 'node:util';

import {stripJsonComments} from './gen_wrangler.mjs';

/** Minimum cool-down (hours) enforced by the cron as well. */
export const MIN_DELAY_HOURS = 24;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Returns a ULID for `ms` (48-bit time + 80 random bits).
 * @param {number} ms
 */
export function ulid(ms = Date.now()) {
  let time = '';
  let t = ms;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const rnd = randomBytes(16);
  let tail = '';
  for (let i = 0; i < 16; i++) tail += CROCKFORD[rnd[i] % 32];
  return time + tail;
}

function base64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

/**
 * Normalizes an address the way identity-access does.
 * @param {string} email
 */
export function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

/**
 * Seals an e-mail exactly like identity-access `aesGcmEncrypt`.
 * @param {string} secret EMAIL_ENC_KEY
 * @param {string} email
 */
export async function encryptEmail(secret, email) {
  const raw = await webcrypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(secret),
  );
  const key = await webcrypto.subtle.importKey('raw', raw, 'AES-GCM', false, [
    'encrypt',
  ]);
  const iv = randomBytes(12);
  const ct = await webcrypto.subtle.encrypt(
    {name: 'AES-GCM', iv},
    key,
    new TextEncoder().encode(normalizeEmail(email)),
  );
  return `${base64url(iv)}.${base64url(new Uint8Array(ct))}`;
}

/**
 * Parses the command line.
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const args = {
    kind: '',
    email: '',
    delayHours: MIN_DELAY_HOURS,
    config: 'apps/identity-access/wrangler.jsonc',
    local: false,
    persistTo: '',
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--kind') args.kind = argv[++i] ?? '';
    else if (a === '--email') args.email = argv[++i] ?? '';
    else if (a === '--delay-hours') args.delayHours = Number(argv[++i]);
    else if (a === '-c' || a === '--config') args.config = argv[++i] ?? '';
    else if (a === '--local') args.local = true;
    else if (a === '--persist-to') args.persistTo = argv[++i] ?? '';
    else if (a === '--dry-run') args.dryRun = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (args.kind !== 'email' && args.kind !== 'passkey_reset') {
    throw new Error('--kind email|passkey_reset is required');
  }
  if (args.kind === 'email') {
    const e = normalizeEmail(args.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 254) {
      throw new Error('--email must be a valid address');
    }
  } else if (args.email) {
    throw new Error('--email is only valid with --kind email');
  }
  if (!Number.isFinite(args.delayHours) || args.delayHours < MIN_DELAY_HOURS) {
    throw new Error(`--delay-hours must be ≥ ${MIN_DELAY_HOURS}`);
  }
  if (args.persistTo && !args.local) {
    throw new Error('--persist-to needs --local');
  }
  return args;
}

function sqlString(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * Builds the INSERT statement.
 * @param {{kind: string, payload: string | null, id: string,
 *   requestedAt: number, effectiveAt: number}} row
 */
export function insertSql(row) {
  if (row.effectiveAt < row.requestedAt + MIN_DELAY_HOURS * 3_600_000) {
    throw new Error('effective_at must be ≥ requested_at + 24 h');
  }
  return (
    'INSERT INTO admin_pending_change (id, kind, payload, requested_at, effective_at) ' +
    `VALUES (${sqlString(row.id)}, ${sqlString(row.kind)}, ` +
    `${row.payload === null ? 'NULL' : sqlString(row.payload)}, ` +
    `${row.requestedAt}, ${row.effectiveAt});`
  );
}

/**
 * Builds the row for parsed arguments.
 * @param {ReturnType<typeof parseArgs>} args
 * @param {{now?: number, encKey?: string}} opts
 */
export async function buildRow(args, opts = {}) {
  const now = opts.now ?? Date.now();
  let payload = null;
  if (args.kind === 'email') {
    if (!opts.encKey) throw new Error('EMAIL_ENC_KEY is not set');
    payload = JSON.stringify({
      emailEnc: await encryptEmail(opts.encKey, args.email),
    });
  }
  return {
    id: ulid(now),
    kind: args.kind,
    payload,
    requestedAt: now,
    effectiveAt: now + Math.ceil(args.delayHours * 3_600_000),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const row = await buildRow(args, {encKey: process.env.EMAIL_ENC_KEY});
  const sql = insertSql(row);
  if (args.dryRun) {
    console.log(sql);
    return;
  }
  const configPath = resolve(args.config);
  const config = JSON.parse(
    stripJsonComments(readFileSync(configPath, 'utf8')),
  );
  const db = config.d1_databases?.find(d => d.binding === 'IDENTITY_DB');
  if (!db) throw new Error(`No IDENTITY_DB in ${args.config}`);
  const where = args.local
    ? ['--local', ...(args.persistTo ? ['--persist-to', args.persistTo] : [])]
    : ['--remote'];
  execFileSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      db.database_name,
      ...where,
      '-c',
      configPath,
      '--command',
      sql,
    ],
    {env: {...process.env, CI: 'true'}, stdio: ['ignore', 'ignore', 'inherit']},
  );
  console.log(
    `admin_pending_change ${row.id} (${row.kind}) applies at ` +
      `${new Date(row.effectiveAt).toISOString()}; the admin address is notified by the next cron.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
