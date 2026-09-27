#!/usr/bin/env node
/**
 * @fileoverview Dependency-free sanity check of the public API contract
 * (CI step; the full two-way operationId ↔ routes.ts check is a gateway
 * test). Verifies that the file:
 *
 *   - exists and declares `openapi: 3.2.x`, `info:`, `paths:`;
 *   - has unique operationIds;
 *   - resolves every local `$ref: '#/components/<section>/<name>'`.
 *
 *   node scripts/check_openapi.mjs [apps/api-gateway/openapi.yaml]
 */

import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

/**
 * Returns the list of problems found in an OpenAPI YAML text (empty when
 * it passes).
 * @param {string} text
 */
export function checkOpenApi(text) {
  const problems = [];
  if (!/^openapi:\s*['"]?3\.2\.\d+['"]?\s*$/m.test(text)) {
    problems.push('missing `openapi: 3.2.x`');
  }
  for (const key of ['info', 'paths', 'components']) {
    if (!new RegExp(`^${key}:`, 'm').test(text)) {
      problems.push(`missing top-level \`${key}:\``);
    }
  }

  const seen = new Map();
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const m = /^\s*operationId:\s*['"]?([A-Za-z0-9_.-]+)/.exec(line);
    if (!m) return;
    if (seen.has(m[1])) {
      problems.push(
        `duplicate operationId ${m[1]} (lines ${seen.get(m[1])} and ${i + 1})`,
      );
    } else {
      seen.set(m[1], i + 1);
    }
  });
  if (seen.size === 0) problems.push('no operationId found');

  // components.<section>.<name> declared at 4-space indentation.
  const declared = new Set();
  let section = '';
  let inComponents = false;
  for (const line of lines) {
    if (/^\S/.test(line)) inComponents = /^components:/.test(line);
    if (!inComponents) continue;
    const s = /^ {2}([A-Za-z]+):/.exec(line);
    if (s) section = s[1];
    const n = /^ {4}([A-Za-z0-9_.-]+):/.exec(line);
    if (n && section) declared.add(`${section}/${n[1]}`);
  }
  const missing = new Set();
  for (const m of text.matchAll(/\$ref:\s*['"]#\/components\/([^'"]+)['"]/g)) {
    if (!declared.has(m[1])) missing.add(m[1]);
  }
  for (const ref of missing)
    problems.push(`unresolved $ref #/components/${ref}`);
  return problems;
}

function main() {
  const file = process.argv[2] ?? 'apps/api-gateway/openapi.yaml';
  if (!existsSync(file)) {
    console.error(`check_openapi: ${file} not found`);
    process.exit(1);
  }
  const problems = checkOpenApi(readFileSync(file, 'utf8'));
  if (problems.length > 0) {
    console.error(`check_openapi: ${file}`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(`check_openapi: ${file} ok`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
