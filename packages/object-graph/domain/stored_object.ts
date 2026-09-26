/**
 * @fileoverview Persistent shapes of objects and links as the domain sees
 * them (independent of D1 row encoding).
 */

import type {Provenance, Rid} from '@ontodecide/shared-kernel';

/** An overwritten value kept in the provenance history. */
export type HistoryEntry = Provenance & {value: unknown};

/** An object as stored in the authoritative store. */
export interface StoredObject {
  rid: Rid;
  tenantId: string;
  type: string;
  primaryKey: string;
  title: string;
  props: Record<string, unknown>;
  propsHash: string;
  provenance: Record<string, Provenance>;
  history: Record<string, HistoryEntry[]>;
  schemaVersion: string;
  version: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/** A directed, typed link. */
export interface StoredLink {
  type: string;
  src: Rid;
  dst: Rid;
  weight?: number | null;
}

/** Stable key of a link. */
export function linkKey(l: {type: string; src: string; dst: string}): string {
  return `${l.type}|${l.src}|${l.dst}`;
}

/** Stable key of an object identity `(type, primaryKey)`. */
export function objectKey(type: string, primaryKey: string): string {
  return `${type}\u001f${primaryKey}`;
}

/**
 * Whether an object is a stub created for a dangling link target (it has no
 * provenance yet; the first real upsert fills it).
 */
export function isStub(o: Pick<StoredObject, 'provenance'>): boolean {
  return Object.keys(o.provenance).length === 0;
}
