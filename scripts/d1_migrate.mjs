#!/usr/bin/env node
/**
 * @fileoverview Applies a Worker's D1 migrations with a guard against V1.3
 * databases.
 *
 * V2.4 keeps the D1 names ({prefix}-<service>-db) but replaces the whole
 * schema (migrations/<service>/0001_ce_*.sql). A database that still records
 * migrations which no longer exist locally (the V1.3 ones) would fail on
 * the first CREATE TABLE. In that case the script stops with an error,
 * unless `--reset-legacy` is given: then every table and view is dropped
 * (all data is lost) and the V2.4 migrations are applied to the empty
 * database. Deploys pass it only when the GitHub variable D1_RESET_LEGACY is
 * `true` (one-time, for the V1.3 → V2.4 rollout); `pnpm dev` passes it for
 * the disposable local state.
 *
 *   node scripts/d1_migrate.mjs -c apps/<worker>/wrangler.jsonc
 *       [--local [--persist-to DIR]] [--reset-legacy]
 *
 * Workers without a D1 database are skipped.
 */

import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {stripJsonComments} from './gen_wrangler.mjs';

function parseArgs(argv) {
  const args = {config: '', local: false, persistTo: '', resetLegacy: false};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-c' || a === '--config') args.config = argv[++i];
    else if (a === '--local') args.local = true;
    else if (a === '--persist-to') args.persistTo = argv[++i];
    else if (a === '--reset-legacy') args.resetLegacy = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!args.config) throw new Error('-c <wrangler.jsonc> is required');
  return args;
}

/** Runs wrangler; returns stdout when captured, else streams it. */
function wrangler(args, capture = true) {
  const out = execFileSync('npx', ['wrangler', ...args], {
    env: {...process.env, CI: 'true'},
    stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'],
  });
  return out ? out.toString() : '';
}

/**
 * Returns the migration names recorded in the database that are not in
 * `localFiles`.
 */
export function unknownMigrations(applied, localFiles) {
  const known = new Set(localFiles);
  return applied.filter(name => !known.has(name));
}

/** Returns SQL dropping every user table and view (virtual tables first). */
export function dropAllSql(objects) {
  const user = objects.filter(
    o => !/^(sqlite_|_cf_)/.test(o.name) && o.name !== 'd1_migrations',
  );
  const order = [
    ...user.filter(o => o.type === 'view'),
    ...user.filter(o => o.type === 'table' && /^CREATE VIRTUAL/i.test(o.sql)),
    ...user.filter(o => o.type === 'table' && !/^CREATE VIRTUAL/i.test(o.sql)),
  ];
  const q = n => `"${n.replace(/"/g, '""')}"`;
  return [
    'PRAGMA defer_foreign_keys = ON;',
    ...order.map(
      o =>
        `DROP ${o.type === 'view' ? 'VIEW' : 'TABLE'} IF EXISTS ${q(o.name)};`,
    ),
    'DROP TABLE IF EXISTS d1_migrations;',
  ].join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = resolve(args.config);
  const config = JSON.parse(
    stripJsonComments(readFileSync(configPath, 'utf8')),
  );
  const db = config.d1_databases?.[0];
  if (!db) {
    console.log('No D1 database.');
    return;
  }
  const where = args.local
    ? ['--local', ...(args.persistTo ? ['--persist-to', args.persistTo] : [])]
    : ['--remote'];
  const base = [db.database_name, ...where, '-c', configPath];
  const query = sql => {
    const out = wrangler([
      'd1',
      'execute',
      ...base,
      '--json',
      '--command',
      sql,
    ]);
    return JSON.parse(out)[0]?.results ?? [];
  };

  const objects = query(
    "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table', 'view')",
  );
  const applied = objects.some(o => o.name === 'd1_migrations')
    ? query('SELECT name FROM d1_migrations').map(r => r.name)
    : [];
  const migrationsDir = join(dirname(configPath), db.migrations_dir);
  const localFiles = readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
  const unknown = unknownMigrations(applied, localFiles);

  if (unknown.length > 0) {
    const what = `${db.database_name} has migrations that no longer exist (${unknown.join(', ')})`;
    if (!args.resetLegacy) {
      throw new Error(
        `${what}. It holds a V1.3 schema; set the GitHub variable ` +
          'D1_RESET_LEGACY=true for one deploy to drop it (all data in it is lost).',
      );
    }
    console.warn(`::warning::${what}; dropping every table (--reset-legacy)`);
    const file = join(mkdtempSync(join(tmpdir(), 'd1-reset-')), 'drop.sql');
    writeFileSync(file, dropAllSql(objects));
    wrangler(['d1', 'execute', ...base, '--file', file], false);
  }
  wrangler(['d1', 'migrations', 'apply', ...base], false);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(`::error::${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
