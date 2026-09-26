/**
 * @fileoverview HTTP entry: the WebSocket stream forwarded by api-gateway
 * (ctx in `x-od-ctx`) goes to the tenant's SituationRoom.
 */

import {
  AppError,
  CTX_HEADER,
  type CallCtx,
  decodeCtx,
  hasRole,
} from '@ontodecide/shared-kernel';

/** Stream path. */
export const STREAM_PATH = '/api/v1/situation/stream';

/** Forwards a request to the SituationRoom DO of a tenant. */
export type RoomFetch = (
  tenantId: string,
  request: Request,
) => Promise<Response>;

function problem(err: AppError): Response {
  return new Response(JSON.stringify(err.toProblem()), {
    status: err.status,
    headers: {'content-type': 'application/problem+json'},
  });
}

/** Builds the fetch handler. */
export function createFetchHandler(
  roomFetch: RoomFetch,
): (request: Request) => Promise<Response> {
  return async request => {
    const url = new URL(request.url);
    if (url.pathname !== STREAM_PATH) {
      return new Response('Not found', {status: 404});
    }
    const header = request.headers.get(CTX_HEADER);
    let ctx: CallCtx;
    try {
      if (!header) throw new Error('missing');
      ctx = decodeCtx(header);
      if (!ctx?.tenantId || !Array.isArray(ctx.roles)) throw new Error('bad');
    } catch {
      return problem(new AppError('AUTH_INVALID', 'Missing call context'));
    }
    if (!hasRole(ctx.roles, 'Viewer')) {
      return problem(new AppError('FORBIDDEN', 'Requires role Viewer'));
    }
    return roomFetch(ctx.tenantId, request);
  };
}
