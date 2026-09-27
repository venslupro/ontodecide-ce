/**
 * @fileoverview Deterministic entity resolution and write planning for
 * upsertBatch (详细设计 6.3.3, 6.11.3). (type, primary key) identifies an
 * object; properties merge latest-wins; links resolve their target by
 * (toType, toKey) among existing objects and the batch itself. The planner
 * enforces the per-workspace object and link limits and is pure: the
 * repository turns the plan into single-statement writes.
 */

import type {ObjectChangeRef, Rid} from '@ontodecide/shared-kernel';
import {validateProps} from '@ontodecide/ontology/contract';
import type {CompiledSchema} from '@ontodecide/ontology/contract';
import type {UpsertCmd, WriteResult} from '../contract/types';
import {isEmptyValue, mergeLatestWins} from './conflict_resolution';
import type {PropState} from './conflict_resolution';
import {titleOf} from './stored_object';
import type {StoredObject} from './stored_object';

/** Workspace limits enforced on writes. */
export interface GraphCaps {
  maxObjects: number;
  maxLinks: number;
}

/** Current workspace totals. */
export interface GraphCounts {
  objects: number;
  links: number;
}

/** An object the batch writes (new, or with changed properties). */
export interface PlannedObject {
  rid: Rid;
  type: string;
  primaryKey: string;
  title: string;
  state: PropState;
  /** True when the object does not exist yet. */
  isNew: boolean;
  /** 1-based position among new objects (for the SQL limit guard). */
  newOrdinal: number | null;
  /** Changed property names (union over the batch). */
  changed: string[];
  /** Source rows that changed this object. */
  rows: number[];
}

/** A link the batch writes (new, or with a changed weight). */
export interface PlannedLink {
  src: Rid;
  type: string;
  dst: Rid;
  weight: number | null;
  isNew: boolean;
  /** 1-based position among new links (for the SQL limit guard). */
  newOrdinal: number | null;
  row: number;
}

/** Everything upsertBatch writes, plus the per-row outcome. */
export interface UpsertPlan {
  objects: PlannedObject[];
  links: PlannedLink[];
  upserted: number;
  skipped: number;
  rejected: WriteResult['rejected'];
}

/** Inputs of {@link planUpsert}. */
export interface PlanInput {
  schema: CompiledSchema;
  cmds: UpsertCmd[];
  /** Existing objects matching any (type, key) of the batch or its links. */
  existing: StoredObject[];
  /** Existing links from the batch's existing objects (weight by key). */
  existingLinks: Map<string, number | null>;
  counts: GraphCounts;
  caps: GraphCaps;
  jobId: string;
  nowMs: number;
  newRid: (type: string) => Rid;
}

/** Map key of an object identity. */
export function objectKey(type: string, primaryKey: string): string {
  return `${type}\u001f${primaryKey}`;
}

/** Map key of a link. */
export function linkKey(src: string, type: string, dst: string): string {
  return `${src}\u001f${type}\u001f${dst}`;
}

interface Working {
  rid: Rid;
  type: string;
  primaryKey: string;
  state: PropState;
  isNew: boolean;
  planned: PlannedObject | null;
}

/** Plans one upsert batch. */
export function planUpsert(input: PlanInput): UpsertPlan {
  const {schema, caps, counts} = input;
  const byKey = new Map<string, Working>();
  for (const o of input.existing) {
    byKey.set(objectKey(o.type, o.primaryKey), {
      rid: o.rid,
      type: o.type,
      primaryKey: o.primaryKey,
      state: {props: o.props, provenance: o.provenance},
      isNew: false,
      planned: null,
    });
  }
  const plan: UpsertPlan = {
    objects: [],
    links: [],
    upserted: 0,
    skipped: 0,
    rejected: [],
  };
  const accepted: {cmd: UpsertCmd; w: Working}[] = [];
  let newObjects = 0;

  for (const cmd of input.cmds) {
    const type = schema.objectTypes[cmd.type];
    if (!type) {
      plan.rejected.push({row: cmd.row, code: 'UNKNOWN_TYPE'});
      continue;
    }
    const pk = String(cmd.primaryKey ?? '').trim();
    if (!pk) {
      plan.rejected.push({
        row: cmd.row,
        code: 'VALIDATION',
        detail: `${type.primaryKey}:REQUIRED`,
      });
      continue;
    }
    const incoming: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(cmd.props ?? {})) {
      if (!isEmptyValue(v)) incoming[k] = v;
    }
    if (type.propsByName[type.primaryKey] && !(type.primaryKey in incoming)) {
      incoming[type.primaryKey] = pk;
    }
    const v = validateProps(type, incoming, {partial: true});
    if (v.errors.length) {
      plan.rejected.push({
        row: cmd.row,
        code: 'VALIDATION',
        detail: v.errors.map(e => `${e.prop}:${e.code}`).join(','),
      });
      continue;
    }
    const key = objectKey(cmd.type, pk);
    let w = byKey.get(key);
    const merged = mergeLatestWins(w?.state ?? null, v.props, {
      jobId: input.jobId,
      row: cmd.row,
      at: input.nowMs,
    });
    if (!w) {
      const missing = type.properties
        .filter(p => p.required && isEmptyValue(merged.state.props[p.apiName]))
        .map(p => `${p.apiName}:REQUIRED`);
      if (missing.length) {
        plan.rejected.push({
          row: cmd.row,
          code: 'VALIDATION',
          detail: missing.join(','),
        });
        continue;
      }
      if (counts.objects + newObjects + 1 > caps.maxObjects) {
        plan.rejected.push({row: cmd.row, code: 'OBJECT_LIMIT'});
        continue;
      }
      newObjects++;
      w = {
        rid: input.newRid(cmd.type),
        type: cmd.type,
        primaryKey: pk,
        state: {props: {}, provenance: {}},
        isNew: true,
        planned: null,
      };
      byKey.set(key, w);
    }
    accepted.push({cmd, w});
    if (!merged.changed.length && (!w.isNew || w.planned)) {
      plan.skipped++;
      continue;
    }
    w.state = merged.state;
    plan.upserted++;
    if (!w.planned) {
      w.planned = {
        rid: w.rid,
        type: w.type,
        primaryKey: w.primaryKey,
        title: '',
        state: w.state,
        isNew: w.isNew,
        newOrdinal: w.isNew ? newObjects : null,
        changed: [],
        rows: [],
      };
      plan.objects.push(w.planned);
    }
    w.planned.state = w.state;
    w.planned.title = titleOf(type, w.state.props, w.primaryKey);
    w.planned.rows.push(cmd.row);
    for (const c of merged.changed) {
      if (!w.planned.changed.includes(c)) w.planned.changed.push(c);
    }
  }

  const planned = new Map<string, PlannedLink>();
  let newLinks = 0;
  for (const {cmd, w} of accepted) {
    for (const l of cmd.links ?? []) {
      const def = schema.linkTypes[l.type];
      if (!def || def.from !== cmd.type || def.to !== l.toType) {
        plan.rejected.push({
          row: cmd.row,
          code: 'VALIDATION',
          detail: `link:${l.type}`,
        });
        continue;
      }
      const target = byKey.get(objectKey(l.toType, String(l.toKey ?? '')));
      if (!target) {
        plan.rejected.push({
          row: cmd.row,
          code: 'REF_MISSING',
          detail: `${l.type}->${l.toType}`,
        });
        continue;
      }
      const weight =
        typeof l.weight === 'number' && Number.isFinite(l.weight)
          ? l.weight
          : null;
      const key = linkKey(w.rid, l.type, target.rid);
      const prior = planned.get(key);
      if (prior) {
        prior.weight = weight;
        continue;
      }
      if (input.existingLinks.has(key)) {
        if (input.existingLinks.get(key) === weight) continue;
        const pl: PlannedLink = {
          src: w.rid,
          type: l.type,
          dst: target.rid,
          weight,
          isNew: false,
          newOrdinal: null,
          row: cmd.row,
        };
        planned.set(key, pl);
        plan.links.push(pl);
        continue;
      }
      if (counts.links + newLinks + 1 > caps.maxLinks) {
        plan.rejected.push({
          row: cmd.row,
          code: 'LINK_LIMIT',
          detail: l.type,
        });
        continue;
      }
      newLinks++;
      const pl: PlannedLink = {
        src: w.rid,
        type: l.type,
        dst: target.rid,
        weight,
        isNew: true,
        newOrdinal: newLinks,
        row: cmd.row,
      };
      planned.set(key, pl);
      plan.links.push(pl);
    }
  }
  plan.rejected.sort((a, b) => a.row - b.row);
  return plan;
}

/** Domain-event changes of a plan: changed objects, then link-only sources. */
export function planChanges(plan: UpsertPlan): ObjectChangeRef[] {
  const out: ObjectChangeRef[] = plan.objects.map(o => ({
    rid: o.rid,
    type: o.type,
    changed: [...o.changed],
  }));
  const seen = new Set(out.map(c => c.rid));
  for (const l of plan.links) {
    if (seen.has(l.src)) continue;
    seen.add(l.src);
    const type = l.src.split('.')[1] ?? '';
    out.push({rid: l.src, type, changed: []});
  }
  return out;
}
