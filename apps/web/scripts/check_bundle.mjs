#!/usr/bin/env node
/**
 * @fileoverview Bundle budget check for the built SPA (前端详细设计 表 1):
 * first-load JavaScript (gzip) per entry, following static imports only.
 *
 * - `/ended` (hard load, `ended.html`)            ≤ 60 KB  (enforced)
 * - initial app shell entry (`index.html`)        reported
 * - `/ended` and `/archive-deletions/:token` reached through the SPA
 *   (entry + route chunk), and the lazy app shell, reported
 * - the public routes must not statically pull in the app shell (enforced)
 *
 * Usage: `pnpm --filter @ontodecide/web build && node scripts/check_bundle.mjs`
 * (or `pnpm --filter @ontodecide/web run check:bundle`). Exits 1 on a
 * budget violation. `--json` prints machine-readable results.
 */

/* global console, process */

import {readdirSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const KB = 1024;

/** Budgets in KB (gzip). */
export const BUDGETS = {endedHardLoad: 60};

const STATIC_IMPORT =
  /(?:^|[;}\s])import\s*(?:[\w$*{}\s,]+?\s*from\s*)?["'](\.\/[^"']+\.js)["']/g;

const gzCache = new Map();
function gz(file) {
  if (!gzCache.has(file))
    gzCache.set(
      file,
      gzipSync(readFileSync(join(DIST, 'assets', file))).length,
    );
  return gzCache.get(file);
}

/** Static-import closure of chunk files (names relative to assets/). */
function closure(files) {
  const seen = new Set();
  const stack = [...files];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const code = readFileSync(join(DIST, 'assets', f), 'utf8');
    for (const m of code.matchAll(STATIC_IMPORT)) stack.push(m[1].slice(2));
  }
  return seen;
}

function entryOf(html) {
  const src = readFileSync(join(DIST, html), 'utf8').match(
    /<script[^>]+type="module"[^>]+src="\/assets\/([^"]+\.js)"/,
  );
  if (!src) throw new Error(`no module script in ${html}`);
  return src[1];
}

const assets = readdirSync(join(DIST, 'assets'));
function chunk(prefix) {
  const f = assets.find(a => a.startsWith(`${prefix}-`) && a.endsWith('.js'));
  if (!f) throw new Error(`chunk ${prefix} not found`);
  return f;
}

const sum = set => [...set].reduce((n, f) => n + gz(f), 0);
const kb = n => Math.round((n / KB) * 10) / 10;

const main = closure([entryOf('index.html')]);
const endedHard = closure([entryOf('ended.html')]);
const shell = chunk('app_layout');
const endedRoute = closure([...main, chunk('ended_page')]);
const deletionRoute = closure([...main, chunk('archive_deletion_page')]);
const shellClosure = closure([shell]);

const results = {
  initialEntry: kb(sum(main)),
  endedHardLoad: kb(sum(endedHard)),
  endedViaSpa: kb(sum(endedRoute)),
  archiveDeletionViaSpa: kb(sum(deletionRoute)),
  appShellExtra: kb(sum(new Set([...shellClosure].filter(f => !main.has(f))))),
};

const failures = [];
if (results.endedHardLoad > BUDGETS.endedHardLoad)
  failures.push(
    `/ended hard load ${results.endedHardLoad} KB > ${BUDGETS.endedHardLoad} KB`,
  );
for (const [name, set] of [
  ['entry', main],
  ['/ended', endedRoute],
  ['/archive-deletions', deletionRoute],
  ['ended.html', endedHard],
]) {
  if (set.has(shell)) failures.push(`${name} statically loads the app shell`);
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({results, failures}, null, 2));
} else {
  console.log('First-load JS (gzip, static imports):');
  for (const [k, v] of Object.entries(results))
    console.log(`  ${k.padEnd(24)} ${String(v).padStart(7)} KB`);
  for (const f of failures) console.error(`✗ ${f}`);
  if (!failures.length) console.log('✓ bundle budgets met');
}
process.exit(failures.length ? 1 : 0);
