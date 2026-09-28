/**
 * @fileoverview Self-checks for admin_pending_change.mjs
 * (`node --test scripts/*_test.mjs`).
 */

import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {execFileSync} from 'node:child_process';
import {webcrypto} from 'node:crypto';
import {URL, fileURLToPath} from 'node:url';
import {TextDecoder, TextEncoder} from 'node:util';
import {test} from 'node:test';

import {
  buildRow,
  encryptEmail,
  insertSql,
  parseArgs,
  ulid,
} from './admin_pending_change.mjs';

async function decrypt(secret, sealed) {
  const [iv, ct] = sealed.split('.');
  const raw = await webcrypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(secret),
  );
  const key = await webcrypto.subtle.importKey('raw', raw, 'AES-GCM', false, [
    'decrypt',
  ]);
  const pt = await webcrypto.subtle.decrypt(
    {name: 'AES-GCM', iv: Buffer.from(iv, 'base64url')},
    key,
    Buffer.from(ct, 'base64url'),
  );
  return new TextDecoder().decode(pt);
}

test('admin_pending_change parses and validates arguments', () => {
  assert.throws(() => parseArgs([]), /--kind/);
  assert.throws(() => parseArgs(['--kind', 'email']), /--email/);
  assert.throws(
    () =>
      parseArgs(['--kind', 'email', '--email', 'a@b.c', '--delay-hours', '23']),
    /≥ 24/,
  );
  assert.throws(
    () => parseArgs(['--kind', 'passkey_reset', '--email', 'a@b.c']),
    /only valid/,
  );
  assert.throws(
    () => parseArgs(['--kind', 'passkey_reset', '--persist-to', 'x']),
    /--local/,
  );
  const a = parseArgs([
    '--kind',
    'email',
    '--email',
    ' New@Example.com ',
    '--local',
    '--dry-run',
  ]);
  assert.equal(a.kind, 'email');
  assert.equal(a.local, true);
  assert.equal(a.dryRun, true);
  assert.equal(a.delayHours, 24);
});

test('admin_pending_change seals the e-mail and enforces the 24 h cool-down', async () => {
  const now = Date.parse('2026-09-28T08:00:00Z');
  const row = await buildRow(
    parseArgs(['--kind', 'email', '--email', 'New@Example.com']),
    {now, encKey: 'enc-key'},
  );
  assert.equal(row.effectiveAt - row.requestedAt, 24 * 3_600_000);
  assert.match(row.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  const payload = JSON.parse(row.payload);
  assert.deepEqual(Object.keys(payload), ['emailEnc']);
  assert.equal(await decrypt('enc-key', payload.emailEnc), 'new@example.com');
  const sql = insertSql(row);
  assert.ok(!sql.toLowerCase().includes('new@example.com'));
  assert.match(
    sql,
    /^INSERT INTO admin_pending_change \(id, kind, payload, requested_at, effective_at\) VALUES \('/,
  );
  assert.throws(() => insertSql({...row, effectiveAt: now + 1000}), /24 h/);
  await assert.rejects(
    buildRow(parseArgs(['--kind', 'email', '--email', 'a@b.co'])),
    /EMAIL_ENC_KEY/,
  );
  const reset = await buildRow(parseArgs(['--kind', 'passkey_reset']), {now});
  assert.equal(reset.payload, null);
  assert.match(insertSql(reset), /'passkey_reset', NULL, /);
  assert.notEqual(
    await encryptEmail('k', 'a@b.co'),
    await encryptEmail('k', 'a@b.co'),
  );
  assert.ok(ulid(now) < ulid(now + 1));
});

test('admin_pending_change --dry-run prints the SQL only', () => {
  const script = fileURLToPath(
    new URL('./admin_pending_change.mjs', import.meta.url),
  );
  const out = execFileSync(
    process.execPath,
    [script, '--kind', 'email', '--email', 'x@example.com', '--dry-run'],
    {env: {...process.env, EMAIL_ENC_KEY: 'k'}},
  ).toString();
  assert.match(out, /^INSERT INTO admin_pending_change/);
  assert.ok(!out.includes('x@example.com'));
});
