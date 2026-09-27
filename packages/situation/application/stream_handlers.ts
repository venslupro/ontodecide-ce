/**
 * @fileoverview Realtime stream (详细设计 6.11.4 连接与鉴权): 30-second
 * single-use tickets (only the SHA-256 is stored), connection cap per user,
 * snapshot on connect, resume replay (≤ 200) or snapshot, closeStreams.
 */

import {
  type CallCtx,
  randomToken,
  serviceCtx,
  sha256Hex,
} from '@ontodecide/shared-kernel';
import type {StreamTicket, WsMsg} from '../contract/types';
import {
  TICKET_TTL_MS,
  formatTicket,
  parseClientFrame,
  planResume,
  socketsToEvict,
  ticketTid,
} from '../domain';
import {SITUATION_SERVICE} from './deps';
import {overview} from './overview';
import type {RedeemedTicket, RoomSocket} from './ports';
import {META, type RoomRuntime} from './support';

/** Close code used when a user's oldest connection is replaced. */
export const STREAM_CLOSE_REPLACED = 4408;

/** Issues a ticket bound to the caller's sub and Act-as flag. */
export async function issueStreamTicket(
  rt: RoomRuntime,
  ctx: CallCtx,
): Promise<StreamTicket> {
  const reactivated = rt.touch(ctx);
  const ticket = formatTicket(ctx.tid, randomToken(24));
  const hash = await sha256Hex(ticket);
  const store = rt.deps.store;
  const now = rt.now();
  store.pruneTickets(now);
  store.insertTicket(hash, {
    sub: ctx.sub,
    actingAs: ctx.actor.actingAs,
    expiresAt: now + TICKET_TTL_MS,
  });
  if (reactivated) await rt.reschedule();
  return {ticket, expiresIn: 30};
}

/**
 * Redeems a ticket: null when malformed, of another workspace, unknown,
 * already used or expired. The ticket is deleted either way.
 */
export async function redeemTicket(
  rt: RoomRuntime,
  ticket: string | null,
): Promise<RedeemedTicket | null> {
  const tid = ticketTid(ticket);
  if (!tid || rt.tombstoned() || rt.tid() !== tid) return null;
  const hash = await sha256Hex(ticket!);
  const rec = rt.deps.store.takeTicket(hash);
  if (!rec || rec.expiresAt <= rt.now()) return null;
  return {sub: rec.sub, actingAs: rec.actingAs};
}

/** Allocates the connection number stored in a new socket's attachment. */
export function nextSocketNumber(rt: RoomRuntime): number {
  const store = rt.deps.store;
  const n = Number(store.getMeta(META.socketSeq) ?? '0') + 1;
  store.setMeta(META.socketSeq, String(n));
  return n;
}

/** Snapshot message (seq = latest buffered seq). */
export async function snapshotMsg(rt: RoomRuntime): Promise<WsMsg> {
  const tid = rt.tid()!;
  const data = await overview(rt, serviceCtx(tid, SITUATION_SERVICE), {
    range: '24h',
  });
  return {
    seq: rt.deps.store.wsBounds().maxSeq,
    type: 'snapshot',
    data,
    occurredAt: new Date(rt.now()).toISOString(),
  };
}

/**
 * Called after a socket was accepted (and tagged with its sub): closes the
 * user's oldest connections beyond the cap, then sends a snapshot.
 */
export async function onConnect(
  rt: RoomRuntime,
  socket: RoomSocket,
): Promise<void> {
  for (const old of socketsToEvict(rt.deps.sockets.list(socket.meta.sub))) {
    if (old.meta.n === socket.meta.n) continue;
    try {
      old.close(STREAM_CLOSE_REPLACED, 'connection limit');
    } catch {
      // Already closed.
    }
  }
  socket.send(JSON.stringify(await snapshotMsg(rt)));
}

/** Handles a client frame (`{"type":"resume","lastSeq":n}`). */
export async function onMessage(
  rt: RoomRuntime,
  socket: RoomSocket,
  text: string,
): Promise<void> {
  const frame = parseClientFrame(text);
  if (!frame) return;
  const {minSeq, maxSeq} = rt.deps.store.wsBounds();
  const plan = planResume(frame.lastSeq, minSeq, maxSeq);
  if (plan.kind === 'none') return;
  if (plan.kind === 'snapshot') {
    socket.send(JSON.stringify(await snapshotMsg(rt)));
    return;
  }
  for (const m of rt.deps.store.wsSince(plan.after)) {
    const msg: WsMsg = {
      seq: m.seq,
      type: m.type,
      data: m.data,
      occurredAt: new Date(m.occurredAt).toISOString(),
    };
    socket.send(JSON.stringify(msg));
  }
}

/**
 * Closes every connection with `code` (4401 when the trial ends) and stops
 * scheduling alarms until a person uses the workspace again.
 */
export async function closeStreams(
  rt: RoomRuntime,
  code: number,
): Promise<void> {
  for (const s of rt.deps.sockets.list()) {
    try {
      s.close(code, 'workspace inactive');
    } catch {
      // Already closed.
    }
  }
  if (!rt.tombstoned() && rt.tid() !== null) {
    rt.deps.store.setMeta(META.inactive, '1');
  }
  await rt.reschedule();
}
