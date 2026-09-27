/**
 * @fileoverview listObjects use case. Filters and sort keys on indexed
 * properties are pushed to D1; the rest is evaluated in memory (a workspace
 * holds ≤ 300 objects). Offset cursors, limit ≤ 100.
 */

import {
  AppError,
  clampLimit,
  decodeCursor,
  encodeCursor,
  filterExprSchema,
  matchFilter,
} from '@ontodecide/shared-kernel';
import type {CallCtx, PageRequest} from '@ontodecide/shared-kernel';
import type {ObjectDto, ObjectPage, ObjectQuery} from '../contract/types';
import {planSort, splitFilter, toObjectDto} from '../domain';
import type {GraphDeps} from './ports';

/** Filtered, ordered, cursor-paged objects. */
export async function listObjects(
  deps: GraphDeps,
  ctx: CallCtx,
  q: ObjectQuery,
  page: PageRequest,
): Promise<ObjectPage> {
  const query = q ?? {};
  if (query.filter !== undefined) {
    const parsed = filterExprSchema.safeParse(query.filter);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'Invalid filter');
    }
  }
  const schema = await deps.schema.get(ctx);
  const type = query.type ? schema.objectTypes[query.type] : undefined;
  if (query.type && !type) return {items: [], nextCursor: null};
  const indexed = new Set(type?.indexedProps ?? []);
  const split = splitFilter(query.filter, indexed);
  const sort = planSort(query.orderBy, indexed);
  const limit = clampLimit(page?.limit);
  const offset = Math.max(
    0,
    Math.floor(Number(decodeCursor<{o: number}>(page?.cursor)?.o ?? 0)) || 0,
  );
  const reader = deps.repos(ctx.tid).reader;
  const base = {
    type: query.type,
    q: query.q?.trim() || undefined,
    pushdown: split.pushdown,
    sort,
  };

  let dtos: ObjectDto[];
  let more: boolean;
  if (!split.residual) {
    const rows = await reader.query({...base, offset, limit: limit + 1});
    more = rows.length > limit;
    dtos = rows.slice(0, limit).map(r => toObjectDto(schema, r));
  } else {
    const rows = await reader.query({...base, offset: 0, limit: null});
    const matched = rows
      .map(r => toObjectDto(schema, r))
      .filter(d => matchFilter(split.residual, d.props));
    more = matched.length > offset + limit;
    dtos = matched.slice(offset, offset + limit);
  }
  return {
    items: dtos,
    nextCursor: more ? encodeCursor({o: offset + limit}) : null,
  };
}
