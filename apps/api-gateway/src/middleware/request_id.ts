/**
 * @fileoverview Request / correlation ids: honors `x-request-id` and
 * `x-correlation-id`, generates a ULID otherwise, echoes both back.
 */

import {ulid} from '@ontodecide/shared-kernel';
import {withHeaders} from '../http';
import type {GatewayDeps, Middleware} from './chain';

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function sanitize(value: string | null): string | undefined {
  return value && ID_PATTERN.test(value) ? value : undefined;
}

/** requestId step. */
export function requestId(deps: GatewayDeps): Middleware {
  return async (s, next) => {
    s.requestId =
      sanitize(s.request.headers.get('x-request-id')) ?? ulid(deps.now());
    s.correlationId =
      sanitize(s.request.headers.get('x-correlation-id')) ?? s.requestId;
    const res = await next();
    return withHeaders(res, {
      'x-request-id': s.requestId,
      'x-correlation-id': s.correlationId,
    });
  };
}
