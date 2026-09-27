/**
 * @fileoverview Single-version workspace ontology operations: reading,
 * creating / replacing and removing a definition of one {@link DefKind}.
 * Pure; the application layer validates and persists the result.
 */

import type {DefByKind, DefKind, OntologyDef} from '../contract';

/** Editable definition kinds (REST resource names). */
export const DEF_KINDS: readonly DefKind[] = [
  'object-types',
  'link-types',
  'action-types',
];

/** Whether a value is a {@link DefKind}. */
export function isDefKind(value: unknown): value is DefKind {
  return (
    typeof value === 'string' &&
    (DEF_KINDS as readonly string[]).includes(value)
  );
}

const FIELD = {
  'object-types': 'objectTypes',
  'link-types': 'linkTypes',
  'action-types': 'actionTypes',
} as const satisfies Record<DefKind, keyof OntologyDef>;

/** Definitions of one kind. */
export function listOf<K extends DefKind>(
  def: OntologyDef,
  kind: K,
): DefByKind[K][] {
  return def[FIELD[kind]] as DefByKind[K][];
}

/** Finds a definition by api name. */
export function findDef<K extends DefKind>(
  def: OntologyDef,
  kind: K,
  id: string,
): DefByKind[K] | undefined {
  return listOf(def, kind).find(d => d.apiName === id);
}

/** Returns a copy with `item` created (appended) or replaced in place. */
export function putDef<K extends DefKind>(
  def: OntologyDef,
  kind: K,
  id: string,
  item: DefByKind[K],
): OntologyDef {
  const items = listOf(def, kind);
  const idx = items.findIndex(d => d.apiName === id);
  const next =
    idx < 0 ? [...items, item] : items.map((d, i) => (i === idx ? item : d));
  return {...def, [FIELD[kind]]: next};
}

/** Returns a copy without the definition `id`. */
export function removeDef(
  def: OntologyDef,
  kind: DefKind,
  id: string,
): OntologyDef {
  const items = listOf(def, kind) as {apiName: string}[];
  return {...def, [FIELD[kind]]: items.filter(d => d.apiName !== id)};
}

/** An empty ontology (purged workspaces). */
export function emptyOntology(): OntologyDef {
  return {
    objectTypes: [],
    linkTypes: [],
    actionTypes: [],
    functions: [],
    simulationKpis: [],
  };
}

/** Fills missing collections of a stored definition. */
export function normalizeOntology(def: Partial<OntologyDef>): OntologyDef {
  return {...emptyOntology(), ...def};
}
