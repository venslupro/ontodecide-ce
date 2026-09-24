#!/usr/bin/env node
/**
 * @fileoverview Fails when the initial JS of the web build exceeds a gzip
 * budget (frontend design: first-screen JS ≤ 250 KB gzip).
 *
 *   node scripts/check_bundle.mjs apps/web/dist 250
 */

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';

const [dist = 'apps/web/dist', budgetKb = '250'] = process.argv.slice(2);
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const scripts = [
  ...html.matchAll(
    /<(?:script[^>]+src|link[^>]+rel="modulepreload"[^>]+href)="([^"]+\.js)"/g,
  ),
].map(m => m[1]);
let total = 0;
for (const src of new Set(scripts)) {
  const bytes = gzipSync(
    readFileSync(join(dist, src.replace(/^\//, ''))),
  ).length;
  total += bytes;
  console.log(`${(bytes / 1024).toFixed(1).padStart(8)} KB  ${src}`);
}
const kb = total / 1024;
console.log(`initial JS: ${kb.toFixed(1)} KB gzip (budget ${budgetKb} KB)`);
if (kb > Number(budgetKb)) process.exit(1);
