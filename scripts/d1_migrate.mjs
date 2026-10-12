#!/usr/bin/env node
/**
 * @fileoverview Applies a Worker's D1 migrations
 * (migrations/<service>/*.sql) with a guard: a database that records
 * migrations which no longer exist in the repository holds a schema this
 * code does not know, so the script stops before touching it.
 *
 *   node scripts/d1_migrate.mjs -c apps/<worker>/wrangler.jsonc
 *       [--local [--persist-to DIR]]
 *
 * Workers without a D1 database are skipped.
 */

import {execFileSync} from 'node:child_process';
import {readFileSync, readdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {stripJsonComments} from './gen_wrangler.mjs';

function parseArgs(argv) {
  const args = {config: '', local: false, persistTo: ''};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-c' || a === '--config') args.config = argv[++i];
    else if (a === '--local') args.local = true;
    else if (a === '--persist-to') args.persistTo = argv[++i];
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
    throw new Error(
      `${db.database_name} has migrations that no longer exist ` +
        `(${unknown.join(', ')}); refusing to migrate an unknown schema.`,
    );
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
