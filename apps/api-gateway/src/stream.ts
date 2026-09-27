/**
 * @fileoverview `GET /situation/stream?ticket=`: after the Origin check the
 * original upgrade request is forwarded to situation-awareness, whose
 * SituationRoom (selected by the ticket's `{tid}` prefix) redeems the
 * one-time ticket. The 101 response is returned untouched.
 */

import {AppError} from '@ontodecide/shared-kernel';
import type {RouteHandler} from './route_types';

const TICKET = /^[0-9A-HJKMNP-TV-Z]{26}\.[A-Za-z0-9_-]{16,128}$/;

/** WebSocket forwarding handler. */
export const streamHandler: RouteHandler = async (env, input) => {
  const upgrade = input.request.headers.get('upgrade');
  if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
    throw new AppError('VALIDATION_FAILED', 'Expected a WebSocket upgrade', {
      status: 426,
    });
  }
  const ticket = new URL(input.request.url).searchParams.get('ticket');
  if (!ticket || !TICKET.test(ticket)) {
    throw new AppError('UNAUTHENTICATED', 'Invalid stream ticket');
  }
  return env.SITUATION.fetch(input.request);
};
