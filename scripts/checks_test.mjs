/**
 * @fileoverview Self-checks for check_sql.mjs, check_openapi.mjs and
 * d1_migrate.mjs (`node --test scripts/*_test.mjs`).
 */

import assert from 'node:assert/strict';
import {test} from 'node:test';

import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {initialScripts, parseEntries, staticImports} from './check_bundle.mjs';
import {checkOpenApi, validateOpenApi} from './check_openapi.mjs';
import {isExempt} from './check_sql.mjs';
import {dropAllSql, unknownMigrations} from './d1_migrate.mjs';

test('check_sql exemptions', () => {
  assert.equal(
    isExempt('a/d1_repo.ts', 'class R extends TenantRepository {}'),
    false,
  );
  assert.equal(
    isExempt('a/d1_repo.ts', 'class R extends SystemRepository {}'),
    true,
  );
  assert.equal(isExempt('a/system_sweeper.ts', ''), true);
  assert.equal(isExempt('a/tenant_lifecycle_d1.ts', ''), true);
  assert.equal(isExempt('a/d1_repo_test.ts', ''), true);
});

test('check_openapi', () => {
  const ok = [
    'openapi: 3.2.0',
    'info: {title: t, version: 1}',
    'paths:',
    '  /a:',
    '    get:',
    '      operationId: getA',
    "      responses: {'200': {$ref: '#/components/responses/Ok'}}",
    'components:',
    '  responses:',
    '    Ok: {description: ok}',
  ].join('\n');
  assert.deepEqual(checkOpenApi(ok), []);
  const bad = ok
    .replace('3.2.0', '3.1.0')
    .replace('responses/Ok', 'responses/Nope')
    .concat('\n      operationId: getA');
  const problems = checkOpenApi(bad);
  assert.equal(problems.length, 3, problems.join('; '));
});

test('validateOpenApi: official 3.2 schema + JSON Schema 2020-12', async () => {
  const text = readFileSync(
    join(import.meta.dirname, '..', 'apps/api-gateway/openapi.yaml'),
    'utf8',
  );
  assert.deepEqual(await validateOpenApi(text), []);
  const badSchema = text.replace(
    /^ {2}schemas:$/m,
    '  schemas:\n    Broken: {type: strng}',
  );
  assert.match(
    (await validateOpenApi(badSchema)).join('\n'),
    /components\/schemas\/Broken/,
  );
  const badDoc = text.replace(/^info:$/m, 'info:\n  bogusField: 1');
  assert.match(
    (await validateOpenApi(badDoc)).join('\n'),
    /OpenAPI 3\.2 schema: \/info/,
  );
});

test('check_bundle helpers', () => {
  assert.deepEqual(
    staticImports(
      'import{a as b}from"./x-1.js";import"./y-2.js";const c=import("./lazy.js")',
    ),
    ['x-1.js', 'y-2.js'],
  );
  assert.deepEqual(
    initialScripts(
      '<script type="module" src="/assets/index-1.js"></script>' +
        '<link rel="modulepreload" href="/assets/r-2.js">' +
        '<script type="module" src="/assets/index-1.js"></script>',
    ),
    ['assets/index-1.js', 'assets/r-2.js'],
  );
  assert.deepEqual(
    parseEntries([
      'dist',
      '250',
      '--entry',
      'ended_page=60',
      '--entry-total',
      'x=5',
    ]),
    [
      {name: 'ended_page', kb: 60, total: false},
      {name: 'x', kb: 5, total: true},
    ],
  );
  assert.throws(() => parseEntries(['--entry', 'nope']), /name=kb/);
});

test('d1_migrate helpers', () => {
  assert.deepEqual(
    unknownMigrations(['0001_ce_x.sql', '0001_x_init.sql'], ['0001_ce_x.sql']),
    ['0001_x_init.sql'],
  );
  const sql = dropAllSql([
    {type: 'table', name: 'd1_migrations', sql: ''},
    {type: 'table', name: '_cf_KV', sql: ''},
    {type: 'table', name: 'og_object', sql: 'CREATE TABLE og_object(x)'},
    {
      type: 'table',
      name: 'og_fts',
      sql: 'CREATE VIRTUAL TABLE og_fts USING fts5(x)',
    },
    {type: 'view', name: 'v', sql: 'CREATE VIEW v AS SELECT 1'},
  ]);
  assert.deepEqual(sql.split('\n'), [
    'PRAGMA defer_foreign_keys = ON;',
    'DROP VIEW IF EXISTS "v";',
    'DROP TABLE IF EXISTS "og_fts";',
    'DROP TABLE IF EXISTS "og_object";',
    'DROP TABLE IF EXISTS d1_migrations;',
  ]);
});
