/**
 * @fileoverview D1 row ⇄ domain mapping helpers.
 */

import {parseJson} from '@ontodecide/shared-kernel';
import type {Provenance, Rid} from '@ontodecide/shared-kernel';
import type {HistoryEntry, StoredLink, StoredObject} from '../domain';

/** Columns selected for objects (prefixed by alias `o`). */
export const OBJECT_COLUMNS =
  'o.rid, o.tenant_id, o.object_type, o.primary_key, o.title, o.props, o.props_hash, o.provenance, o.prov_history, o.schema_version, o.version, o.updated_at';

/** og_object row. */
export interface ObjectRow {
  rid: string;
  tenant_id: string;
  object_type: string;
  primary_key: string;
  title: string | null;
  props: string;
  props_hash: string;
  provenance: string;
  prov_history: string | null;
  schema_version: string;
  version: number;
  updated_at: number;
}

/** Maps an og_object row. */
export function toStoredObject(r: ObjectRow): StoredObject {
  return {
    rid: r.rid as Rid,
    tenantId: r.tenant_id,
    type: r.object_type,
    primaryKey: r.primary_key,
    title: r.title ?? r.primary_key,
    props: parseJson<Record<string, unknown>>(r.props, {}),
    propsHash: r.props_hash,
    provenance: parseJson<Record<string, Provenance>>(r.provenance, {}),
    history: parseJson<Record<string, HistoryEntry[]>>(r.prov_history, {}),
    schemaVersion: r.schema_version,
    version: Number(r.version),
    updatedAt: Number(r.updated_at),
  };
}

/** og_link row. */
export interface LinkRow {
  link_type: string;
  src_rid: string;
  dst_rid: string;
  weight: number | null;
}

/** Maps an og_link row. */
export function toStoredLink(r: LinkRow): StoredLink {
  return {
    type: r.link_type,
    src: r.src_rid as Rid,
    dst: r.dst_rid as Rid,
    weight:
      r.weight === null || r.weight === undefined ? null : Number(r.weight),
  };
}

/** Splits a list into chunks. */
export function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}
