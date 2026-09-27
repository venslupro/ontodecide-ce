/**
 * @fileoverview Realtime stream rules (详细设计 6.11.4): ticket format,
 * client frames, resume planning and the per-user connection cap.
 */

import {CE_LIMITS, LIFECYCLE, isUlid} from '@ontodecide/shared-kernel';
import {WS_REPLAY_MAX} from '../contract/types';

/** Ticket lifetime. */
export const TICKET_TTL_MS = LIFECYCLE.streamTicketSec * 1000;

/** Builds a ticket `{tid}.{random}`. */
export function formatTicket(tid: string, random: string): string {
  return `${tid}.${random}`;
}

/** Workspace id of a well-formed ticket, else null. */
export function ticketTid(ticket: string | null | undefined): string | null {
  if (!ticket || ticket.length > 128) return null;
  const dot = ticket.indexOf('.');
  if (dot <= 0) return null;
  const tid = ticket.slice(0, dot);
  const random = ticket.slice(dot + 1);
  if (!isUlid(tid) || !/^[A-Za-z0-9_-]{16,86}$/.test(random)) return null;
  return tid;
}

/** A parsed client frame. */
export type ClientFrame = {type: 'resume'; lastSeq: number};

/** Parses a client frame; unknown or malformed frames are null. */
export function parseClientFrame(text: string): ClientFrame | null {
  if (text.length > 1024) return null;
  try {
    const v = JSON.parse(text) as {type?: unknown; lastSeq?: unknown};
    if (
      v?.type === 'resume' &&
      typeof v.lastSeq === 'number' &&
      Number.isInteger(v.lastSeq) &&
      v.lastSeq >= 0
    ) {
      return {type: 'resume', lastSeq: v.lastSeq};
    }
  } catch {
    // Not JSON.
  }
  return null;
}

/** How to answer a resume request. */
export type ResumePlan =
  {kind: 'none'} | {kind: 'replay'; after: number} | {kind: 'snapshot'};

/**
 * Replays the gap when it is still buffered (≤ 200 messages), otherwise
 * asks for a snapshot. `minSeq` / `maxSeq` bound the buffered messages
 * (0 when empty).
 */
export function planResume(
  lastSeq: number,
  minSeq: number,
  maxSeq: number,
): ResumePlan {
  if (lastSeq === maxSeq) return {kind: 'none'};
  if (lastSeq > maxSeq) return {kind: 'snapshot'};
  if (maxSeq - lastSeq > WS_REPLAY_MAX || minSeq > lastSeq + 1) {
    return {kind: 'snapshot'};
  }
  return {kind: 'replay', after: lastSeq};
}

/** Attachment stored with every accepted socket. */
export interface SocketMeta {
  sub: string;
  actingAs: boolean;
  /** Monotonic connection number within the room (oldest = smallest). */
  n: number;
}

/**
 * Sockets to close so a user keeps at most `cap` connections (the oldest
 * are closed first).
 */
export function socketsToEvict<T extends {meta: SocketMeta}>(
  sockets: readonly T[],
  cap: number = CE_LIMITS.streams,
): T[] {
  if (sockets.length <= cap) return [];
  return [...sockets]
    .sort((a, b) => a.meta.n - b.meta.n)
    .slice(0, sockets.length - cap);
}
