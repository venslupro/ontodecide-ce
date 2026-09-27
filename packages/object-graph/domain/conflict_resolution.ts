/**
 * @fileoverview Property conflict resolution (详细设计 6.3.3): latest-wins —
 * a later non-empty value overwrites the current one and its provenance
 * records the import job and row. Also the RFC 7396 merge patch used by
 * PATCH /objects/{rid}.
 */

import {canonicalJson} from '@ontodecide/shared-kernel';
import type {Provenance} from '@ontodecide/shared-kernel';

/** Properties with their per-property provenance. */
export interface PropState {
  props: Record<string, unknown>;
  provenance: Record<string, Provenance>;
}

/** Result of a merge. */
export interface MergeOutcome {
  state: PropState;
  /** Properties whose value changed. */
  changed: string[];
}

/** Whether a value counts as empty (never overwrites). */
export function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

/** Deep, key-order independent equality of two values. */
export function sameValue(a: unknown, b: unknown): boolean {
  return canonicalJson(a ?? null) === canonicalJson(b ?? null);
}

/**
 * Merges incoming (already validated) properties into the current state.
 * Empty incoming values are ignored; properties absent from the input are
 * kept; changed properties get the incoming provenance.
 */
export function mergeLatestWins(
  current: PropState | null,
  incoming: Record<string, unknown>,
  provenance: Provenance,
): MergeOutcome {
  const props = {...(current?.props ?? {})};
  const prov = {...(current?.provenance ?? {})};
  const changed: string[] = [];
  for (const [prop, value] of Object.entries(incoming)) {
    if (isEmptyValue(value)) continue;
    if (prop in props && sameValue(props[prop], value)) continue;
    props[prop] = value;
    prov[prop] = provenance;
    changed.push(prop);
  }
  return {state: {props, provenance: prov}, changed};
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** RFC 7396 JSON Merge Patch of an arbitrary JSON value. */
export function applyMergePatch(target: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch;
  const out: Record<string, unknown> = isPlainObject(target) ? {...target} : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = applyMergePatch(out[k], v);
  }
  return out;
}

/**
 * Applies a merge patch to properties. Returns the new properties and the
 * names whose value changed (added, replaced or removed). Provenance of
 * changed properties is dropped: the value no longer comes from an import.
 */
export function patchProps(
  current: PropState,
  patch: Record<string, unknown>,
): MergeOutcome {
  const props = applyMergePatch(current.props, patch) as Record<
    string,
    unknown
  >;
  const changed = Object.keys(patch).filter(
    k => !sameValue(current.props[k], props[k]),
  );
  const provenance = {...current.provenance};
  for (const k of changed) delete provenance[k];
  return {state: {props, provenance}, changed};
}
