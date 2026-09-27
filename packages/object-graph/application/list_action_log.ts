/**
 * @fileoverview listActionLog use case: action audit of one object, newest
 * first, keyset-paged (limit ≤ 100).
 */

import {
  clampLimit,
  decodeCursor,
  encodeCursor,
  isRid,
} from '@ontodecide/shared-kernel';
import type {CallCtx, PageRequest, Rid} from '@ontodecide/shared-kernel';
import type {ActionLogDto} from '../contract/types';
import type {GraphDeps} from './ports';

/** Action log entries of one object. */
export async function listActionLog(
  deps: GraphDeps,
  ctx: CallCtx,
  rid: Rid,
  page: PageRequest,
): Promise<{items: ActionLogDto[]; nextCursor: string | null}> {
  if (!isRid(rid)) return {items: [], nextCursor: null};
  const limit = clampLimit(page?.limit);
  const c = decodeCursor<{t: number; id: string}>(page?.cursor);
  const after =
    c && typeof c.t === 'number' && typeof c.id === 'string'
      ? {at: c.t, id: c.id}
      : null;
  const rows = await deps
    .repos(ctx.tid)
    .actions.listForTarget(rid, after, limit + 1);
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({t: Date.parse(last.executedAt), id: last.id})
        : null,
  };
}
