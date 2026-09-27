/**
 * @fileoverview Alert list (filter + keyset paging) and acknowledgement.
 */

import {
  AppError,
  type CallCtx,
  type PageRequest,
  type PageResult,
  clampLimit,
  decodeCursor,
  encodeCursor,
  notFound,
} from '@ontodecide/shared-kernel';
import type {AlertDto, AlertFilter} from '../contract/types';
import {ensureInitialized} from './install_pack_content';
import type {AlertCursor, AlertRecord} from './ports';
import {type RoomRuntime, toAlertDto} from './support';

/** Lists alerts, newest first. */
export async function listAlerts(
  rt: RoomRuntime,
  ctx: CallCtx,
  filter: AlertFilter,
  page: PageRequest,
): Promise<PageResult<AlertDto>> {
  rt.touch(ctx);
  await ensureInitialized(rt);
  const limit = clampLimit(page.limit);
  const cursor = decodeCursor<AlertCursor>(page.cursor);
  if (page.cursor && (!cursor || typeof cursor.t !== 'number')) {
    throw new AppError('VALIDATION_FAILED', 'Invalid cursor');
  }
  const rows = rt.deps.store.listAlerts(filter ?? {}, cursor, limit + 1);
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items: items.map(toAlertDto),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({t: last.raisedAt, i: last.id})
        : null,
  };
}

/**
 * Acknowledges an OPEN alert (idempotent for ACKED; CONFLICT when CLOSED).
 */
export async function acknowledgeAlert(
  rt: RoomRuntime,
  ctx: CallCtx,
  id: string,
): Promise<AlertDto> {
  rt.touch(ctx);
  const store = rt.deps.store;
  const a = store.getAlert(id);
  if (!a) notFound('Alert not found');
  if (a.status === 'ACKED') return toAlertDto(a);
  if (a.status === 'CLOSED') {
    throw new AppError('CONFLICT', 'Alert is already closed');
  }
  const acked: AlertRecord = {...a, status: 'ACKED', ackedAt: rt.now()};
  store.updateAlert(acked);
  rt.pushAlerts([acked]);
  return toAlertDto(acked);
}
