/**
 * @fileoverview Schema compiler: derives lookups, index plan and a content
 * hash from a schema definition.
 */

import {canonicalJson, sha256Hex} from '@ontodecide/shared-kernel';
import type {
  CompiledObjectType,
  CompiledSchema,
  DataType,
  IndexPlanEntry,
  SchemaDef,
} from '../contract';

const NUM_INDEX_TYPES = new Set<string>(['integer', 'double', 'boolean']);

/**
 * Index column kind for a data type; mirrors `indexValue` in the contract
 * (numbers and booleans → num, everything else → str).
 */
export function indexKind(dataType: DataType): IndexPlanEntry['kind'] {
  return NUM_INDEX_TYPES.has(dataType) ? 'num' : 'str';
}

/** Content hash of a definition: sha256 of its canonical JSON. */
export function schemaHash(def: SchemaDef): Promise<string> {
  return sha256Hex(canonicalJson(def));
}

/** Compiles a schema definition published as `version`. */
export async function compileSchema(
  def: SchemaDef,
  version: string,
): Promise<CompiledSchema> {
  const objectTypes: Record<string, CompiledObjectType> = {};
  const indexPlan: IndexPlanEntry[] = [];
  for (const t of def.objectTypes) {
    const propsByName = Object.fromEntries(
      t.properties.map(p => [p.apiName, p]),
    );
    const indexed = t.properties.filter(p => p.indexed);
    objectTypes[t.apiName] = {
      ...t,
      schemaApi: def.apiName,
      propsByName,
      indexedProps: indexed.map(p => p.apiName),
      sensitiveProps: t.properties.filter(p => p.sensitive).map(p => p.apiName),
    };
    for (const p of indexed) {
      indexPlan.push({
        objectType: t.apiName,
        prop: p.apiName,
        kind: indexKind(p.dataType),
      });
    }
  }
  return {
    apiName: def.apiName,
    version,
    hash: await schemaHash(def),
    objectTypes,
    linkTypes: Object.fromEntries(def.linkTypes.map(l => [l.apiName, l])),
    actionTypes: Object.fromEntries(def.actionTypes.map(a => [a.apiName, a])),
    functions: Object.fromEntries(def.functions.map(f => [f.apiName, f])),
    simulationKpis: def.simulationKpis ?? [],
    indexPlan,
  };
}

/** Index plan entries of `next` that are absent (or differ in kind) from `prev`. */
export function indexChanges(
  prev: readonly IndexPlanEntry[],
  next: readonly IndexPlanEntry[],
): IndexPlanEntry[] {
  const key = (e: IndexPlanEntry) =>
    `${e.objectType}\u0000${e.prop}\u0000${e.kind}`;
  const old = new Set(prev.map(key));
  return next.filter(e => !old.has(key(e)));
}
