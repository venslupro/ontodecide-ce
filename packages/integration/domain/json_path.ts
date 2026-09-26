/**
 * @fileoverview A small JSONPath subset for REST and webhook payloads:
 * `$`, `$.a.b`, `$.a[*]`, `$.a.b[0]`, `$['a']` and combinations such as
 * `$.data[*].items`.
 */

import {AppError} from '@ontodecide/shared-kernel';

type Token =
  {kind: 'key'; key: string} | {kind: 'index'; i: number} | {kind: 'all'};

const CACHE = new Map<string, Token[]>();

/** Parses a path; throws VALIDATION_FAILED when unsupported. */
export function parseJsonPath(path: string): Token[] {
  const cached = CACHE.get(path);
  if (cached) return cached;
  const p = path.trim();
  if (!p.startsWith('$')) {
    throw new AppError(
      'VALIDATION_FAILED',
      `JSONPath must start with $: ${path}`,
    );
  }
  const tokens: Token[] = [];
  let i = 1;
  while (i < p.length) {
    const ch = p[i];
    if (ch === '.') {
      const m = p.slice(i + 1).match(/^[A-Za-z0-9_$-]+/);
      if (!m) throw new AppError('VALIDATION_FAILED', `Bad JSONPath: ${path}`);
      tokens.push({kind: 'key', key: m[0]});
      i += 1 + m[0].length;
    } else if (ch === '[') {
      const end = p.indexOf(']', i);
      if (end < 0)
        throw new AppError('VALIDATION_FAILED', `Bad JSONPath: ${path}`);
      const inner = p.slice(i + 1, end).trim();
      if (inner === '*') tokens.push({kind: 'all'});
      else if (/^\d+$/.test(inner))
        tokens.push({kind: 'index', i: Number(inner)});
      else if (/^(['"]).*\1$/.test(inner))
        tokens.push({kind: 'key', key: inner.slice(1, -1)});
      else throw new AppError('VALIDATION_FAILED', `Bad JSONPath: ${path}`);
      i = end + 1;
    } else {
      throw new AppError('VALIDATION_FAILED', `Bad JSONPath: ${path}`);
    }
  }
  if (CACHE.size > 200) CACHE.clear();
  CACHE.set(path, tokens);
  return tokens;
}

/** Evaluates a path; returns every match (wildcards fan out). */
export function queryJsonPath(root: unknown, path: string): unknown[] {
  let current: unknown[] = [root];
  for (const t of parseJsonPath(path)) {
    const next: unknown[] = [];
    for (const v of current) {
      if (t.kind === 'key') {
        if (v && typeof v === 'object' && !Array.isArray(v) && t.key in v) {
          next.push((v as Record<string, unknown>)[t.key]);
        }
      } else if (t.kind === 'index') {
        if (Array.isArray(v) && t.i < v.length) next.push(v[t.i]);
      } else if (Array.isArray(v)) {
        next.push(...v);
      } else if (v && typeof v === 'object') {
        next.push(...Object.values(v));
      }
    }
    current = next;
  }
  return current;
}

/** Returns the first match or undefined. */
export function selectJsonPath(root: unknown, path: string): unknown {
  return queryJsonPath(root, path)[0];
}

/**
 * Extracts a records array: wildcard paths return their matches; a single
 * array match is returned as is; a single object becomes `[object]`.
 */
export function extractItems(root: unknown, path = '$'): unknown[] {
  const hasWildcard = parseJsonPath(path).some(t => t.kind === 'all');
  const matches = queryJsonPath(root, path);
  if (hasWildcard) return matches;
  const v = matches[0];
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}
