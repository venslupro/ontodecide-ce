/**
 * @fileoverview Request body limit (详细设计 6.7: ≤ 512 KB). Oversized
 * bodies answer 413 with code VALIDATION_FAILED; the body is read with a
 * running byte count so a missing or lying Content-Length cannot bypass it.
 */

import {AppError} from '@ontodecide/shared-kernel';
import {isWriteMethod} from '../route_types';
import type {GatewayDeps, Middleware} from './chain';

function tooLarge(max: number): AppError {
  return new AppError(
    'VALIDATION_FAILED',
    `Request body exceeds ${max} bytes`,
    {status: 413},
  );
}

/** Reads a request body as UTF-8, failing once `max` bytes are exceeded. */
export async function readBody(req: Request, max: number): Promise<string> {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge(max);
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

/** Body limit step. */
export function bodyLimit(deps: GatewayDeps): Middleware {
  return async (s, next) => {
    if (!isWriteMethod(s.method)) return next();
    const declared = Number(s.request.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > deps.maxBodyBytes) {
      throw tooLarge(deps.maxBodyBytes);
    }
    s.rawBody = await readBody(s.request, deps.maxBodyBytes);
    return next();
  };
}
