/**
 * @fileoverview Schema diff: compares a draft against the current published
 * version, classifies breaking changes and suggests the next semver.
 *
 * Breaking changes are: removing an object type, property, link type or
 * action type; changing a property's data type; changing a primary key.
 */

import {canonicalJson} from '@ontodecide/shared-kernel';
import type {DiffReport, SchemaChange, SchemaDef} from '../contract';
import {bumpSemver, compareSemver, isSemver} from './semver';

/** Version used for the first publish when the definition sets none. */
export const INITIAL_VERSION = '1.0.0';

function byName<T extends {apiName: string}>(items: readonly T[]) {
  return new Map(items.map(i => [i.apiName, i]));
}

function same(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** Lists the changes from `from` to `to` (both may be absent). */
export function schemaChanges(
  from: SchemaDef | null,
  to: SchemaDef,
): SchemaChange[] {
  const changes: SchemaChange[] = [];
  const add = (
    kind: SchemaChange['kind'],
    path: string,
    breaking: boolean,
    detail?: string,
  ): void => {
    changes.push({kind, path, breaking, ...(detail ? {detail} : {})});
  };

  const oldTypes = byName(from?.objectTypes ?? []);
  const newTypes = byName(to.objectTypes);
  for (const [name, t] of newTypes) {
    const old = oldTypes.get(name);
    const base = `objectTypes.${name}`;
    if (!old) {
      add('objectTypeAdded', base, false);
      continue;
    }
    if (old.primaryKey !== t.primaryKey) {
      add(
        'propertyChanged',
        `${base}.primaryKey`,
        true,
        `${old.primaryKey} → ${t.primaryKey}`,
      );
    }
    const oldProps = byName(old.properties);
    const newProps = byName(t.properties);
    for (const [pn, p] of newProps) {
      const op = oldProps.get(pn);
      const path = `${base}.properties.${pn}`;
      if (!op) add('propertyAdded', path, false);
      else if (op.dataType !== p.dataType) {
        add(
          'propertyTypeChanged',
          path,
          true,
          `${op.dataType} → ${p.dataType}`,
        );
      } else if (!same(op, p)) add('propertyChanged', path, false);
    }
    for (const pn of oldProps.keys()) {
      if (!newProps.has(pn))
        add('propertyRemoved', `${base}.properties.${pn}`, true);
    }
  }
  for (const name of oldTypes.keys()) {
    if (!newTypes.has(name))
      add('objectTypeRemoved', `objectTypes.${name}`, true);
  }

  const oldLinks = byName(from?.linkTypes ?? []);
  const newLinks = byName(to.linkTypes);
  for (const [name, l] of newLinks) {
    const old = oldLinks.get(name);
    const path = `linkTypes.${name}`;
    if (!old) add('linkTypeAdded', path, false);
    else if (
      old.from !== l.from ||
      old.to !== l.to ||
      old.cardinality !== l.cardinality
    ) {
      // Re-targeting a link is a removal of the old link plus a new one.
      const detail = `${old.from}→${old.to} (${old.cardinality}) → ${l.from}→${l.to} (${l.cardinality})`;
      add('linkTypeRemoved', path, true, detail);
      add('linkTypeAdded', path, false, detail);
    }
  }
  for (const name of oldLinks.keys()) {
    if (!newLinks.has(name)) add('linkTypeRemoved', `linkTypes.${name}`, true);
  }

  const oldActions = byName(from?.actionTypes ?? []);
  const newActions = byName(to.actionTypes);
  for (const [name, a] of newActions) {
    const old = oldActions.get(name);
    const path = `actionTypes.${name}`;
    if (!old) add('actionTypeAdded', path, false);
    else if (!same(old, a)) add('actionTypeChanged', path, false);
  }
  for (const name of oldActions.keys()) {
    if (!newActions.has(name))
      add('actionTypeRemoved', `actionTypes.${name}`, true);
  }
  return changes;
}

/** Whether functions or simulation KPIs were added (no change kind of their own). */
function hasUntrackedAdditions(from: SchemaDef | null, to: SchemaDef): boolean {
  const oldFns = new Set((from?.functions ?? []).map(f => f.apiName));
  const oldKpis = new Set((from?.simulationKpis ?? []).map(k => k.apiName));
  return (
    to.functions.some(f => !oldFns.has(f.apiName)) ||
    (to.simulationKpis ?? []).some(k => !oldKpis.has(k.apiName))
  );
}

/**
 * Diffs a draft against the current published schema.
 *
 * `suggestedVersion` follows semver (major if breaking, minor if anything was
 * added, patch otherwise); the first publish suggests the draft's own version
 * or 1.0.0. `toVersion` is the draft's version when it is newer than the
 * current one, else the suggested version.
 */
export function diffSchemas(
  current: {version: string; definition: SchemaDef} | null,
  draft: SchemaDef,
): DiffReport {
  const changes = schemaChanges(current?.definition ?? null, draft);
  const breaking = changes.some(c => c.breaking);
  const own = isSemver(draft.version) ? draft.version : undefined;
  let suggestedVersion: string;
  let toVersion: string;
  if (!current) {
    suggestedVersion = own ?? INITIAL_VERSION;
    toVersion = suggestedVersion;
  } else {
    const additions =
      changes.some(c => c.kind.endsWith('Added')) ||
      hasUntrackedAdditions(current.definition, draft);
    suggestedVersion = bumpSemver(
      current.version,
      breaking ? 'major' : additions ? 'minor' : 'patch',
    );
    toVersion =
      own && compareSemver(own, current.version) > 0 ? own : suggestedVersion;
  }
  return {
    apiName: draft.apiName,
    fromVersion: current?.version ?? null,
    toVersion,
    breaking,
    changes,
    suggestedVersion,
  };
}
