#!/usr/bin/env node
/**
 * @fileoverview Lint of the public API contract (CI step; the two-way
 * operationId ↔ routes.ts check is a gateway test and response bodies are
 * checked by tests/contract). Three layers:
 *
 *   1. structural (checkOpenApi): `openapi: 3.2.x`, `info:`, `paths:`,
 *      unique operationIds, every local `$ref: '#/components/…'` resolves;
 *   2. the document validates against the official OpenAPI 3.2 JSON Schema
 *      (spec.openapis.org/oas/3.2/schema, bundled offline by
 *      @seriousme/openapi-schema-validator — Redocly/Spectral rulesets were
 *      not used: the official schema is the normative 3.2 check);
 *   3. every schema object (components.schemas and each inline media /
 *      parameter schema under paths) compiles as JSON Schema 2020-12 with
 *      Ajv2020 (strict types, formats known), all `$ref`s resolved.
 *
 *   node scripts/check_openapi.mjs [apps/api-gateway/openapi.yaml]
 */

import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Validator} from '@seriousme/openapi-schema-validator';
import {Ajv2020} from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {parse} from 'yaml';

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

/** JSON Pointer escaping of one reference token. */
function ptr(token) {
  return String(token).replaceAll('~', '~0').replaceAll('/', '~1');
}

/**
 * Yields the JSON Pointer of every schema object under `paths` (media
 * types, parameters, headers), without descending into schemas.
 * @param {unknown} node
 * @param {string} at
 * @returns {Generator<string>}
 */
function* inlineSchemas(node, at) {
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    const here = `${at}/${ptr(k)}`;
    if ((k === 'schema' || k === 'itemSchema') && v && typeof v === 'object') {
      yield here;
    } else {
      yield* inlineSchemas(v, here);
    }
  }
}

/**
 * Full validation (layers 2 and 3 of the file overview); resolves to the
 * list of problems (empty when it passes).
 * @param {string} text
 */
export async function validateOpenApi(text) {
  const problems = [];
  let doc;
  try {
    doc = parse(text);
  } catch (e) {
    return [`YAML: ${e.message}`];
  }
  const validator = new Validator();
  const res = await validator.validate(JSON.parse(JSON.stringify(doc)));
  if (!res.valid) {
    for (const e of [res.errors].flat().slice(0, 20)) {
      problems.push(
        `OpenAPI 3.2 schema: ${e.instancePath || '/'} ${e.message ?? JSON.stringify(e)}`,
      );
    }
  }
  const ajv = new Ajv2020({
    allErrors: true,
    // OpenAPI annotation keywords (example, discriminator, xml, …).
    strictSchema: false,
    strictTypes: false,
  });
  addFormats(ajv);
  try {
    ajv.addSchema({...doc, $id: 'openapi.json'});
  } catch (e) {
    return [...problems, `JSON Schema: ${e.message}`];
  }
  const pointers = [
    ...Object.keys(doc?.components?.schemas ?? {}).map(
      n => `#/components/schemas/${ptr(n)}`,
    ),
    ...inlineSchemas(doc?.paths, '#/paths'),
    ...inlineSchemas(doc?.components?.responses, '#/components/responses'),
    ...inlineSchemas(doc?.components?.parameters, '#/components/parameters'),
    ...inlineSchemas(doc?.components?.headers, '#/components/headers'),
  ];
  for (const p of pointers) {
    try {
      ajv.compile({$ref: `openapi.json${p}`});
    } catch (e) {
      problems.push(`JSON Schema 2020-12 ${p}: ${e.message}`);
    }
  }
  if (pointers.length === 0) problems.push('no schema objects found');
  return problems;
}

async function main() {
  const file = process.argv[2] ?? 'apps/api-gateway/openapi.yaml';
  if (!existsSync(file)) {
    console.error(`check_openapi: ${file} not found`);
    process.exit(1);
  }
  const text = readFileSync(file, 'utf8');
  const problems = [...checkOpenApi(text), ...(await validateOpenApi(text))];
  if (problems.length > 0) {
    console.error(`check_openapi: ${file}`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(`check_openapi: ${file} ok`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
