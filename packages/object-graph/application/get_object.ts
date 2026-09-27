/**
 * @fileoverview Object read use cases: getObject and getObjects. Stored
 * properties are projected onto the current ontology.
 */

import {AppError, isRid} from '@ontodecide/shared-kernel';
import type {CallCtx, Rid} from '@ontodecide/shared-kernel';
import {GRAPH_LIMITS} from '../contract/types';
import type {ObjectDto} from '../contract/types';
import {toObjectDto} from '../domain';
import type {GraphDeps} from './ports';

/** One object, or null when missing or in another workspace. */
export async function getObject(
  deps: GraphDeps,
  ctx: CallCtx,
  rid: Rid,
): Promise<ObjectDto | null> {
  if (!isRid(rid)) return null;
  const row = await deps.repos(ctx.tid).reader.get(rid);
  if (!row) return null;
  return toObjectDto(await deps.schema.get(ctx), row);
}

/** Objects by rid (≤ 300); missing rids are omitted. */
export async function getObjects(
  deps: GraphDeps,
  ctx: CallCtx,
  rids: Rid[],
): Promise<ObjectDto[]> {
  const unique = [...new Set((rids ?? []).filter(isRid))];
  if (unique.length > GRAPH_LIMITS.subgraphNodesMax) {
    throw new AppError(
      'VALIDATION_FAILED',
      `At most ${GRAPH_LIMITS.subgraphNodesMax} rids per call`,
    );
  }
  if (!unique.length) return [];
  const [rows, schema] = await Promise.all([
    deps.repos(ctx.tid).reader.getMany(unique),
    deps.schema.get(ctx),
  ]);
  const byRid = new Map(rows.map(r => [r.rid as string, r]));
  return unique
    .filter(r => byRid.has(r))
    .map(r => toObjectDto(schema, byRid.get(r)!));
}
