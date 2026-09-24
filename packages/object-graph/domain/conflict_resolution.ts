/**
 * @fileoverview Property-level conflict resolution. Each incoming property
 * value competes with the current one under the source's policy; values that
 * lose their place are kept in a bounded provenance history.
 */

import {canonicalJson} from '@ontodecide/shared-kernel';
import type {Provenance} from '@ontodecide/shared-kernel';
import {GRAPH_LIMITS} from '../contract/types';
import type {HistoryEntry} from './stored_object';

/** Conflict resolution policy (configured per source). */
export type ConflictPolicy =
  'latest-wins' | 'source-priority' | 'max-confidence';

/** Properties with their provenance and overwritten history. */
export interface PropState {
  props: Record<string, unknown>;
  provenance: Record<string, Provenance>;
  history: Record<string, HistoryEntry[]>;
}

/** Result of merging an incoming record into the current state. */
export interface MergeOutcome {
  state: PropState;
  /** Properties whose value changed. */
  changed: string[];
}

function timestampOf(p: Provenance): number {
  const t = Date.parse(p.sourceTs ?? p.ingestedAt);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Whether the incoming value replaces the current one. Ties fall back to
 * latest-wins (source timestamp, else ingestion time); an equal timestamp
 * lets the newer arrival win.
 */
export function incomingWins(
  policy: ConflictPolicy,
  current: Provenance | undefined,
  incoming: Provenance,
): boolean {
  if (!current) return true;
  if (policy === 'source-priority') {
    const a = incoming.priority ?? 0;
    const b = current.priority ?? 0;
    if (a !== b) return a > b;
  } else if (policy === 'max-confidence') {
    if (incoming.confidence !== current.confidence) {
      return incoming.confidence > current.confidence;
    }
  }
  return timestampOf(incoming) >= timestampOf(current);
}

/** Whether two property values are equal (deep, key-order independent). */
export function sameValue(a: unknown, b: unknown): boolean {
  return canonicalJson(a ?? null) === canonicalJson(b ?? null);
}

/** Prepends an overwritten value to a property's history (≤ 5 kept). */
export function pushHistory(
  history: Record<string, HistoryEntry[]>,
  prop: string,
  entry: HistoryEntry,
): Record<string, HistoryEntry[]> {
  const list = [entry, ...(history[prop] ?? [])].slice(
    0,
    GRAPH_LIMITS.provenanceHistoryMax,
  );
  return {...history, [prop]: list};
}

/**
 * Merges incoming properties into the current state. Null or missing
 * incoming values never overwrite; properties absent from the record are
 * kept. Returns the new state and the names of changed properties.
 */
export function mergeProps(
  current: PropState | null,
  incoming: Record<string, unknown>,
  provenance: Provenance,
  policy: ConflictPolicy,
): MergeOutcome {
  const props = {...(current?.props ?? {})};
  const prov = {...(current?.provenance ?? {})};
  let history = {...(current?.history ?? {})};
  const changed: string[] = [];
  for (const [prop, value] of Object.entries(incoming)) {
    if (value === null || value === undefined) continue;
    const has = props[prop] !== undefined && props[prop] !== null;
    if (has && sameValue(props[prop], value)) continue;
    const curProv = has ? prov[prop] : undefined;
    if (has && !incomingWins(policy, curProv, provenance)) continue;
    if (has && curProv) {
      history = pushHistory(history, prop, {...curProv, value: props[prop]});
    }
    props[prop] = value;
    prov[prop] = provenance;
    changed.push(prop);
  }
  return {state: {props, provenance: prov, history}, changed};
}

/**
 * Sets properties unconditionally (action effects), recording overwritten
 * values in the history.
 */
export function overwriteProps(
  current: PropState,
  updates: Record<string, unknown>,
  provenance: Provenance,
): MergeOutcome {
  const props = {...current.props};
  const prov = {...current.provenance};
  let history = {...current.history};
  const changed: string[] = [];
  for (const [prop, value] of Object.entries(updates)) {
    if (sameValue(props[prop], value)) continue;
    if (props[prop] !== undefined && props[prop] !== null) {
      const old: Provenance = prov[prop] ?? {
        sourceId: 'unknown',
        datasetTxn: '',
        recordRef: '',
        ingestedAt: provenance.ingestedAt,
        confidence: 0,
      };
      history = pushHistory(history, prop, {...old, value: props[prop]});
    }
    if (value === null || value === undefined) {
      delete props[prop];
      delete prov[prop];
    } else {
      props[prop] = value;
      prov[prop] = provenance;
    }
    changed.push(prop);
  }
  return {state: {props, provenance: prov, history}, changed};
}
