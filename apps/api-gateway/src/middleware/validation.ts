/**
 * @fileoverview Input validation step: path parameters, query and JSON
 * body against the contracts' zod schemas (400 VALIDATION_FAILED with
 * field errors). Bodies must be `application/json` or
 * `application/merge-patch+json` (415 VALIDATION_FAILED otherwise).
 */

import {AppError, parseOrThrow} from '@ontodecide/shared-kernel';
import type {GatewayState, Middleware} from './chain';

const JSON_TYPES = ['application/json', 'application/merge-patch+json'];

function parseBody(s: GatewayState): unknown {
  if (!s.rawBody.trim()) return {};
  const type = (s.request.headers.get('content-type') ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (!JSON_TYPES.includes(type)) {
    throw new AppError('VALIDATION_FAILED', 'Unsupported content type', {
      status: 415,
    });
  }
  try {
    return JSON.parse(s.rawBody);
  } catch {
    throw new AppError('VALIDATION_FAILED', 'Malformed JSON body', {
      extras: {errors: [{path: '', message: 'Malformed JSON'}]},
    });
  }
}

function queryObject(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of url.searchParams) if (!(k in out)) out[k] = v;
  return out;
}

/** Validation step. */
export function validation(): Middleware {
  return async (s, next) => {
    const r = s.route;
    if (!r) return next();
    for (const [name, schema] of Object.entries(r.params ?? {})) {
      const result = schema.safeParse(s.params[name]);
      if (!result.success) {
        throw new AppError('VALIDATION_FAILED', 'Invalid path parameter', {
          extras: {errors: [{path: `path.${name}`, message: 'Invalid'}]},
        });
      }
    }
    const rawQuery = queryObject(s.url);
    s.query = r.query ? parseOrThrow(r.query, rawQuery) : rawQuery;
    s.body = r.body ? parseOrThrow(r.body, parseBody(s)) : undefined;
    return next();
  };
}
