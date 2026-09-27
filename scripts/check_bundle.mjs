#!/usr/bin/env node
/**
 * @fileoverview Fails when the initial JS of the web build exceeds a gzip
 * budget (frontend design: first-screen JS ≤ 250 KB gzip), and optionally
 * when a lazily loaded route chunk exceeds its own budget.
 *
 *   node scripts/check_bundle.mjs apps/web/dist 250 [--entry <name>=<kb>]…
 *     [--entry-total <name>=<kb>]…
 *
 * `--entry ended_page=40` budgets what navigating to that route downloads
 * beyond the initial JS: every chunk `assets/<name>-<hash>.js` plus its
 * static-import closure, minus the files already in the initial set.
 * `--entry-total` budgets the whole static closure of the chunk (initial
 * files included) — for pages that must not load the app shell. A missing
 * chunk fails (a renamed route must update its budget).
 */

import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';

/** Static imports (`import … from"./x.js"`, `import"./x.js"`) of a chunk. */
export function staticImports(code) {
  return [
    ...code.matchAll(/(?:\bfrom|\bimport)\s*["']\.\/([^"']+\.js)["']/g),
  ].map(m => m[1]);
}

/** Initial JS files (relative to dist) referenced by index.html. */
export function initialScripts(html) {
  return [
    ...new Set(
      [
        ...html.matchAll(
          /<(?:script[^>]+src|link[^>]+rel="modulepreload"[^>]+href)="([^"]+\.js)"/g,
        ),
      ].map(m => m[1].replace(/^\//, '')),
    ),
  ];
}

/**
 * Closure of `roots` (paths relative to dist) over static imports.
 * @param {string} dist
 * @param {string[]} roots
 */
export function closure(dist, roots) {
  const seen = new Set();
  const stack = [...roots];
  while (stack.length > 0) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/') + 1) : '';
    for (const i of staticImports(readFileSync(join(dist, f), 'utf8'))) {
      stack.push(dir + i);
    }
  }
  return seen;
}

const ENTRY_FLAGS = ['--entry', '--entry-total'];

/** Parses `--entry name=kb` / `--entry-total name=kb` flags. */
export function parseEntries(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (!ENTRY_FLAGS.includes(args[i])) continue;
    const m = /^([\w.-]+)=(\d+(?:\.\d+)?)$/.exec(args[i + 1] ?? '');
    if (!m) throw new Error(`bad ${args[i]} ${args[i + 1]} (want name=kb)`);
    out.push({
      name: m[1],
      kb: Number(m[2]),
      total: args[i] === '--entry-total',
    });
    i++;
  }
  return out;
}

function gz(dist, f) {
  return gzipSync(readFileSync(join(dist, f))).length;
}

function main() {
  const args = process.argv.slice(2);
  const positional = args.filter(
    (a, i) => !ENTRY_FLAGS.includes(a) && !ENTRY_FLAGS.includes(args[i - 1]),
  );
  const [dist = 'apps/web/dist', budgetKb = '250'] = positional;
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const initial = initialScripts(html);
  let failed = false;
  let total = 0;
  for (const src of initial) {
    const bytes = gz(dist, src);
    total += bytes;
    console.log(`${(bytes / 1024).toFixed(1).padStart(8)} KB  ${src}`);
  }
  const kb = total / 1024;
  console.log(`initial JS: ${kb.toFixed(1)} KB gzip (budget ${budgetKb} KB)`);
  if (kb > Number(budgetKb)) failed = true;

  const assets = readdirSync(join(dist, 'assets'));
  const loaded = closure(dist, initial);
  for (const {name, kb: limit, total: whole} of parseEntries(args)) {
    const roots = assets
      .filter(a => a.endsWith('.js') && a.startsWith(`${name}-`))
      .map(a => `assets/${a}`);
    if (roots.length === 0) {
      console.error(`entry ${name}: no chunk assets/${name}-*.js`);
      failed = true;
      continue;
    }
    const files = [...closure(dist, roots)];
    const counted = whole
      ? [...new Set([...files, ...initial])]
      : files.filter(f => !loaded.has(f));
    const ekb = counted.reduce((n, f) => n + gz(dist, f), 0) / 1024;
    console.log(
      `entry ${name}: ${whole ? '' : '+'}${ekb.toFixed(1)} KB gzip ` +
        `${whole ? 'in total' : 'beyond initial'} ` +
        `(${counted.length} files, budget ${limit} KB)`,
    );
    if (ekb > limit) failed = true;
  }
  if (failed) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
