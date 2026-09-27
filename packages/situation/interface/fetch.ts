/**
 * @fileoverview `GET /api/v1/situation/stream?ticket=` forwarded by
 * api-gateway (after its Origin check): the ticket's `{tid}` prefix selects
 * the room, which redeems the ticket and upgrades the connection.
 */

import {
  AppError,
  type ErrorCode,
  PROBLEM_MEDIA_TYPE,
} from '@ontodecide/shared-kernel';
import {ticketTid} from '../domain';
import type {RoomResolver} from './rpc';

/** A room stub that accepts forwarded fetches. */
export interface RoomFetcher {
  fetch(request: Request): Promise<Response>;
}

/** RFC 9457 response for the stream endpoint. */
export function problemResponse(code: ErrorCode, detail?: string): Response {
  const err = new AppError(code, detail);
  return new Response(JSON.stringify(err.toProblem()), {
    status: err.status,
    headers: {'content-type': PROBLEM_MEDIA_TYPE},
  });
}

/** Whether a request asks for a WebSocket upgrade. */
export function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
}

/** Builds the stream fetch handler. */
export function createStreamFetch(
  rooms: RoomResolver<RoomFetcher>,
): (request: Request) => Promise<Response> {
  return async request => {
    if (request.method !== 'GET') {
      return problemResponse('NOT_FOUND');
    }
    if (!isWebSocketUpgrade(request)) {
      const res = problemResponse(
        'VALIDATION_FAILED',
        'WebSocket upgrade required',
      );
      return new Response(res.body, {status: 426, headers: res.headers});
    }
    const ticket = new URL(request.url).searchParams.get('ticket');
    const tid = ticketTid(ticket);
    if (!tid)
      return problemResponse('UNAUTHENTICATED', 'Invalid stream ticket');
    return rooms(tid).fetch(request);
  };
}
