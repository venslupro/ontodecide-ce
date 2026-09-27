/**
 * @fileoverview Response contract test: re-runs the end-to-end flows of
 * tests/e2e (their `it` blocks are imported into this file) with the
 * harness's `api()` recording every response, then validates each JSON
 * body — success DTOs and RFC 9457 Problem Details alike — against the
 * response schema that apps/api-gateway/openapi.yaml declares for that
 * path, method, status and media type. OpenAPI 3.2 schemas are JSON Schema
 * 2020-12, so Ajv2020 compiles them directly. An undocumented path,
 * status or media type fails loudly instead of being skipped.
 */

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {Ajv2020, type ValidateFunction} from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {describe, expect, it, vi} from 'vitest';
import {parse} from 'yaml';
import {REPO_ROOT} from '../../packages/testing';
import type {ApiOptions, ApiResponse} from '../e2e/harness';

/** One response observed through the gateway. */
interface Recorded {
  method: string;
  path: string;
  status: number;
  contentType: string;
  body: unknown;
}

const recorded = vi.hoisted(() => [] as Recorded[]);

vi.mock('../e2e/harness', async importOriginal => {
  const mod = await importOriginal<typeof import('../e2e/harness')>();
  return {
    ...mod,
    createSystem: async () => {
      const sys = await mod.createSystem();
      const api = async <T = Record<string, unknown>>(
        method: string,
        path: string,
        o?: ApiOptions,
      ): Promise<ApiResponse<T>> => {
        const res = await sys.api<T>(method, path, o);
        recorded.push({
          method,
          path,
          status: res.status,
          contentType: res.headers.get('content-type') ?? '',
          body: res.body,
        });
        return res;
      };
      return {...sys, api};
    },
  };
});

// The e2e flows, re-registered in this file with the recording harness.
await import('../e2e/full_loop_test');
await import('../e2e/admin_and_trial_end_test');

type Json = Record<string, unknown>;

const doc = parse(
  readFileSync(join(REPO_ROOT, 'apps/api-gateway/openapi.yaml'), 'utf8'),
) as Json;

const ajv = new Ajv2020({
  allErrors: true,
  // OpenAPI annotation keywords (example, discriminator, xml, …).
  strictSchema: false,
  validateFormats: true,
});
addFormats(ajv);
ajv.addSchema({...doc, $id: 'openapi.json'} as Json);

/** JSON Pointer escaping of one reference token. */
function ptr(token: string): string {
  return token.replaceAll('~', '~0').replaceAll('/', '~1');
}

/** Resolves a local `$ref` object (components/responses etc.). */
function deref<T>(node: T): T {
  let n = node as Json;
  while (n && typeof n.$ref === 'string') {
    const parts = (n.$ref as string).replace(/^#\//, '').split('/');
    n = parts.reduce<Json>(
      (o, p) => o?.[p.replaceAll('~1', '/').replaceAll('~0', '~')] as Json,
      doc,
    );
  }
  return n as T;
}

const templates = Object.keys(doc.paths as Json).map(t => ({
  template: t,
  params: (t.match(/\{/g) ?? []).length,
  re: new RegExp(
    `^${t.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[^}]+\}/g, '[^/]+')}$`,
  ),
}));

/** The path template a concrete path matches (fewest parameters wins). */
function templateOf(path: string): string | null {
  const bare = path.split('?')[0];
  const hits = templates
    .filter(t => t.re.test(bare))
    .sort((a, b) => a.params - b.params);
  return hits[0]?.template ?? null;
}

const compiled = new Map<string, ValidateFunction>();

/** Schema JSON Pointer and compiled validator of one response, or a reason. */
function validatorFor(r: Recorded): ValidateFunction | string {
  const template = templateOf(r.path);
  if (!template) return `no path template matches ${r.path}`;
  const op = (doc.paths as Json)[template] as Json;
  const method = r.method.toLowerCase();
  if (!op[method]) return `${method.toUpperCase()} ${template} not documented`;
  const responses = (op[method] as Json).responses as Json;
  const code = String(r.status);
  const range = `${code[0]}XX`;
  const key = [code, range, 'default'].find(k => k in responses);
  if (!key) return `${code} not documented for ${r.method} ${template}`;
  if (r.status < 400 && key === 'default') {
    return `success ${code} of ${r.method} ${template} only matches default`;
  }
  const res = deref(responses[key] as Json);
  const mediaType = r.contentType.split(';')[0].trim();
  if (r.body === undefined || r.body === '') {
    return 'empty';
  }
  const content = (res.content ?? {}) as Json;
  if (!(mediaType in content)) {
    return `${mediaType || '(none)'} not documented for ${code} of ${r.method} ${template}`;
  }
  if (!/[/+]json$/.test(mediaType)) return 'not-json';
  const media = content[mediaType] as Json;
  if (!media.schema) {
    return `no schema for ${mediaType} ${code} of ${r.method} ${template}`;
  }
  // Point into the document when the response is inline, so that nested
  // local $refs resolve; into components/responses when it is a $ref.
  const raw = responses[key] as Json;
  const base =
    typeof raw.$ref === 'string'
      ? (raw.$ref as string)
      : `#/paths/${ptr(template)}/${method}/responses/${ptr(key)}`;
  const pointer = `openapi.json${base}/content/${ptr(mediaType)}/schema`;
  let v = compiled.get(pointer);
  if (!v) {
    v = ajv.compile({$ref: pointer});
    compiled.set(pointer, v);
  }
  return v;
}

describe('responses match openapi.yaml', () => {
  it('validates every recorded response body', () => {
    expect(recorded.length).toBeGreaterThan(30);
    const problems: string[] = [];
    let validated = 0;
    let problemDetails = 0;
    for (const r of recorded) {
      const v = validatorFor(r);
      if (v === 'empty' || v === 'not-json') continue;
      if (typeof v === 'string') {
        problems.push(v);
        continue;
      }
      validated++;
      if (r.contentType.startsWith('application/problem+json')) {
        problemDetails++;
      }
      if (!v(r.body)) {
        problems.push(
          `${r.method} ${r.path} → ${r.status}: ${ajv.errorsText(v.errors, {
            separator: '; ',
          })}`,
        );
      }
    }
    expect([...new Set(problems)]).toEqual([]);
    expect(validated).toBeGreaterThan(30);
    expect(problemDetails).toBeGreaterThan(3);
  });
});
