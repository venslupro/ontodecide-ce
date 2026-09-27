/**
 * @fileoverview Ontology compiler: derives property lookups, indexed and
 * sensitive property lists and the index plan from a definition.
 */

import type {
  CompiledObjectType,
  CompiledSchema,
  IndexPlanEntry,
  OntologyDef,
} from '../contract';

/** Identity of a compiled ontology. */
export interface CompileMeta {
  templateId: string;
  templateVersion: string;
  custom: boolean;
  etag: number;
}

/** Compiles a (validated) definition. */
export function compileOntology(
  def: OntologyDef,
  meta: CompileMeta,
): CompiledSchema {
  const objectTypes: Record<string, CompiledObjectType> = {};
  const indexPlan: IndexPlanEntry[] = [];
  for (const t of def.objectTypes) {
    const indexed = t.properties.filter(p => p.indexed).map(p => p.apiName);
    objectTypes[t.apiName] = {
      ...t,
      propsByName: Object.fromEntries(t.properties.map(p => [p.apiName, p])),
      indexedProps: indexed,
      sensitiveProps: t.properties.filter(p => p.sensitive).map(p => p.apiName),
    };
    for (const prop of indexed) indexPlan.push({objectType: t.apiName, prop});
  }
  return {
    templateId: meta.templateId,
    templateVersion: meta.templateVersion,
    custom: meta.custom,
    etag: meta.etag,
    objectTypes,
    linkTypes: Object.fromEntries(def.linkTypes.map(l => [l.apiName, l])),
    actionTypes: Object.fromEntries(def.actionTypes.map(a => [a.apiName, a])),
    functions: Object.fromEntries(def.functions.map(f => [f.apiName, f])),
    simulationKpis: def.simulationKpis,
    indexPlan,
  };
}

/** Returns a compiled schema re-labelled with another identity. */
export function withMeta(
  compiled: CompiledSchema,
  meta: CompileMeta,
): CompiledSchema {
  return {...compiled, ...meta};
}
