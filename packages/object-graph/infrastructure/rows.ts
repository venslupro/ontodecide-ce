/**
 * @fileoverview D1 row shapes of object-graph-db and their decoders.
 */

import {parseJson} from '@ontodecide/shared-kernel';
import type {Provenance, Rid} from '@ontodecide/shared-kernel';
import type {ActionLogDto} from '../contract/types';
import type {StoredLink, StoredObject} from '../domain';

/** Columns selected for og_object rows (alias `o`). */
export const OBJECT_COLUMNS =
  'o.rid, o.object_type, o.primary_key, o.title, o.props, o.props_hash, ' +
  'o.provenance, o.version, o.updated_at';

/** An og_object row. */
export interface ObjectRow {
  rid: string;
  object_type: string;
  primary_key: string;
  title: string | null;
  props: string;
  props_hash: string;
  provenance: string;
  version: number;
  updated_at: number;
}

/** Decodes an og_object row. */
export function toStoredObject(r: ObjectRow): StoredObject {
  return {
    rid: r.rid as Rid,
    type: r.object_type,
    primaryKey: r.primary_key,
    title: r.title ?? r.primary_key,
    props: parseJson<Record<string, unknown>>(r.props, {}),
    provenance: parseJson<Record<string, Provenance>>(r.provenance, {}),
    propsHash: r.props_hash,
    version: Number(r.version),
    updatedAt: Number(r.updated_at),
  };
}

/** An og_link row. */
export interface LinkRow {
  src_rid: string;
  link_type: string;
  dst_rid: string;
  weight: number | null;
}

/** Decodes an og_link row. */
export function toStoredLink(r: LinkRow): StoredLink {
  return {
    src: r.src_rid as Rid,
    type: r.link_type,
    dst: r.dst_rid as Rid,
    weight:
      r.weight === null || r.weight === undefined ? null : Number(r.weight),
  };
}

/** An og_action_log row. */
export interface ActionLogDbRow {
  id: string;
  action_type: string;
  target_rid: string;
  params: string | null;
  before: string | null;
  after: string | null;
  actor: string;
  actor_user_id: string | null;
  recommendation_id: string | null;
  executed_at: number;
}

/** Decodes an og_action_log row. */
export function toActionLogDto(r: ActionLogDbRow): ActionLogDto {
  return {
    id: r.id,
    actionType: r.action_type,
    targetRid: r.target_rid as Rid,
    params: parseJson(r.params, {}),
    before: parseJson(r.before, {}),
    after: parseJson(r.after, {}),
    actor: r.actor,
    ...(r.actor_user_id ? {actorUserId: r.actor_user_id} : {}),
    ...(r.recommendation_id ? {recommendationId: r.recommendation_id} : {}),
    executedAt: new Date(Number(r.executed_at)).toISOString(),
  };
}

/** Whether a D1 error is a UNIQUE violation on the given table. */
export function isUniqueViolation(e: unknown, table: string): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /UNIQUE constraint failed/i.test(m) && m.includes(`${table}.`);
}
