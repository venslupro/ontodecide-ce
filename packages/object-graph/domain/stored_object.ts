/**
 * @fileoverview Stored object and link shapes and the read projection that
 * turns stored rows into DTOs against the current ontology (详细设计 6.11.3):
 * properties absent from the ontology are dropped, values that no longer
 * match their declared type are reported in `invalidProps`.
 */

import type {Provenance, Rid} from '@ontodecide/shared-kernel';
import type {
  CompiledObjectType,
  CompiledSchema,
  PropertyDef,
} from '@ontodecide/ontology/contract';
import type {GraphNode, ObjectDto} from '../contract/types';

/** An og_object row, decoded. */
export interface StoredObject {
  rid: Rid;
  type: string;
  primaryKey: string;
  title: string;
  props: Record<string, unknown>;
  provenance: Record<string, Provenance>;
  propsHash: string;
  version: number;
  /** Unix milliseconds. */
  updatedAt: number;
}

/** An og_link row. */
export interface StoredLink {
  src: Rid;
  type: string;
  dst: Rid;
  weight: number | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Whether a stored value matches the property's declared data type. */
export function valueMatches(def: PropertyDef, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  switch (def.dataType) {
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'double':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      return typeof value === 'string' && DATE_RE.test(value);
    case 'timestamp':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value));
    case 'geopoint': {
      if (!value || typeof value !== 'object') return false;
      const g = value as Record<string, unknown>;
      return typeof g.lat === 'number' && typeof g.lon === 'number';
    }
    case 'enum':
      return (
        typeof value === 'string' &&
        (!def.enumValues || def.enumValues.includes(value))
      );
    default:
      // objectRef:<Type> — a primary key or RID string.
      return typeof value === 'string';
  }
}

/** Current-ontology view of stored properties. */
export interface ProjectedProps {
  props: Record<string, unknown>;
  provenance: Record<string, Provenance>;
  invalidProps: string[];
}

/**
 * Drops properties the ontology no longer defines and lists the ones whose
 * stored value does not match the declared type. An unknown object type
 * projects to no properties.
 */
export function projectProps(
  type: CompiledObjectType | undefined,
  props: Record<string, unknown>,
  provenance: Record<string, Provenance>,
): ProjectedProps {
  const out: ProjectedProps = {props: {}, provenance: {}, invalidProps: []};
  if (!type) return out;
  for (const [name, value] of Object.entries(props)) {
    const def = type.propsByName[name];
    if (!def || value === null || value === undefined) continue;
    out.props[name] = value;
    if (provenance[name]) out.provenance[name] = provenance[name];
    if (!valueMatches(def, value)) out.invalidProps.push(name);
  }
  return out;
}

/** Builds the DTO of a stored object. */
export function toObjectDto(
  schema: CompiledSchema,
  o: StoredObject,
): ObjectDto {
  const p = projectProps(schema.objectTypes[o.type], o.props, o.provenance);
  return {
    rid: o.rid,
    type: o.type,
    primaryKey: o.primaryKey,
    title: o.title,
    props: p.props,
    provenance: p.provenance,
    version: o.version,
    updatedAt: new Date(o.updatedAt).toISOString(),
    ...(p.invalidProps.length ? {invalidProps: p.invalidProps} : {}),
  };
}

/** Builds a graph node of a stored object. */
export function toGraphNode(
  schema: CompiledSchema,
  o: StoredObject,
  hop: number,
): GraphNode {
  const p = projectProps(schema.objectTypes[o.type], o.props, o.provenance);
  return {rid: o.rid, type: o.type, title: o.title, props: p.props, hop};
}

/** Title of an object: the title property when set, else the primary key. */
export function titleOf(
  type: CompiledObjectType,
  props: Record<string, unknown>,
  primaryKey: string,
): string {
  const v = props[type.titleProperty];
  if (v === null || v === undefined || v === '') return primaryKey;
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/**
 * Index rows of an object: only indexed properties with a scalar value.
 * Booleans are stored as 0/1, objects as JSON text.
 */
export function indexEntries(
  type: CompiledObjectType,
  props: Record<string, unknown>,
): {prop: string; value: string | number}[] {
  const out: {prop: string; value: string | number}[] = [];
  for (const prop of type.indexedProps) {
    const v = props[prop];
    if (v === null || v === undefined) continue;
    if (typeof v === 'number' || typeof v === 'string') {
      out.push({prop, value: v});
    } else if (typeof v === 'boolean') {
      out.push({prop, value: v ? 1 : 0});
    } else {
      out.push({prop, value: JSON.stringify(v)});
    }
  }
  return out;
}
