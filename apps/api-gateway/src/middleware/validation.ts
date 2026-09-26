/**
 * @fileoverview Reads the body (with a size cap) and validates body and
 * query parameters against the route's zod schemas.
 */

import {AppError, parseOrThrow} from '@ontodecide/shared-kernel';
import {type Middleware, routeOf} from './chain';

/** Default body cap. */
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

/** Reads the request body as text, enforcing a byte limit. */
export async function readBody(
  req: Request,
  maxBytes: number,
): Promise<string> {
  if (!req.body) return '';
  const declared = Number(req.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new AppError('BATCH_TOO_LARGE', `Body exceeds ${maxBytes} bytes`);
  }
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AppError('BATCH_TOO_LARGE', `Body exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** URLSearchParams → plain object (last value wins). */
export function queryObject(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of url.searchParams) out[k] = v;
  return out;
}

/** Validation step. */
export function validation(): Middleware {
  return async (s, next) => {
    const route = routeOf(s);
    const hasBody = s.method !== 'GET' && s.method !== 'HEAD';
    s.rawBody = hasBody
      ? await readBody(s.request, route.maxBytes ?? DEFAULT_MAX_BYTES)
      : '';

    const rawQuery = queryObject(s.url);
    s.query = route.query ? parseOrThrow(route.query, rawQuery) : rawQuery;

    if (route.minRole === 'hmac') {
      // Raw body is verified by the owning service; do not parse it here.
      s.body = undefined;
      return next();
    }
    let parsed: unknown = undefined;
    if (s.rawBody.trim() !== '') {
      try {
        parsed = JSON.parse(s.rawBody);
      } catch {
        throw new AppError('VALIDATION_FAILED', 'Body is not valid JSON', {
          errors: [{path: '', message: 'Invalid JSON'}],
        });
      }
    }
    s.body = route.body ? parseOrThrow(route.body, parsed) : parsed;
    return next();
  };
}
