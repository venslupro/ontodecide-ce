/**
 * @fileoverview requestId step: honors a well-formed `X-Request-Id`,
 * generates a ULID otherwise, and echoes it back. The id is the Problem
 * Details `traceId` and the CallCtx `requestId`.
 */

import {ulid} from '@ontodecide/shared-kernel';
import {withHeaders} from '../http';
import type {GatewayDeps, Middleware} from './chain';

const ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/** requestId step. */
export function requestId(deps: GatewayDeps): Middleware {
  return async (s, next) => {
    const incoming = s.request.headers.get('x-request-id');
    s.requestId =
      incoming && ID_PATTERN.test(incoming)
        ? incoming
        : ulid(deps.clock.now().getTime());
    return withHeaders(await next(), {'x-request-id': s.requestId});
  };
}
