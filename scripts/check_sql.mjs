#!/usr/bin/env node
/**
 * @fileoverview Tenant-isolation guard for D1 access (part of `pnpm lint`).
 *
 * Rule: repositories in packages/<context>/infrastructure/** must not call
 * `.prepare(` directly; tenant data goes through `TenantRepository.stmt()`,
 * which binds tenant_id as ?1. Allowed exceptions (cron / queue /
 * TenantLifecycle code that is tenant-agnostic by design):
 *
 *   - a file that declares a class extending `SystemRepository`;
 *   - a file named `system_*.ts` or `*_lifecycle*.ts`.
 *
 * Tests (`*_test.ts`) are ignored. Exit code 1 lists every violation.
 *
 *   node scripts/check_sql.mjs [root]
 */

import {readdirSync, readFileSync, statSync} from 'node:fs';
import {basename, join, relative} from 'node:path';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Recursively lists .ts files below dir. */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Returns true when the file is exempt from the rule. */
export function isExempt(file, source) {
  const name = basename(file);
  if (name.endsWith('_test.ts')) return true;
  if (name.startsWith('system_') || /_lifecycle[^/]*\.ts$/.test(name)) {
    return true;
  }
  return /class\s+\w+(?:<[^>]*>)?\s+extends\s+SystemRepository\b/.test(source);
}

/**
 * Returns `path:line` for every direct `.prepare(` call in infrastructure
 * code that is not exempt.
 */
export function findViolations(root = ROOT) {
  const packages = join(root, 'packages');
  const violations = [];
  for (const pkg of readdirSync(packages)) {
    const infra = join(packages, pkg, 'infrastructure');
    let files;
    try {
      files = walk(infra);
    } catch {
      continue;
    }
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      if (isExempt(file, source)) continue;
      source.split('\n').forEach((line, i) => {
        if (/\.prepare\s*\(/.test(line)) {
          violations.push(`${relative(root, file)}:${i + 1}`);
        }
      });
    }
  }
  return violations;
}

function main() {
  const violations = findViolations(process.argv[2] ?? ROOT);
  if (violations.length === 0) {
    console.log('check_sql: ok');
    return;
  }
  console.error(
    'check_sql: direct .prepare( in tenant repositories ' +
      '(use TenantRepository.stmt(), or SystemRepository / system_*.ts / ' +
      '*_lifecycle*.ts for tenant-agnostic code):',
  );
  for (const v of violations) console.error(`  ${v}`);
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
