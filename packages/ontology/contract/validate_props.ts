/**
 * @fileoverview Property validation and coercion against a compiled object
 * type. Pure; shared by data-integration (mapping) and object-graph (write).
 */

import type {CompiledObjectType, DataType, PropertyDef} from './schema';

/** A property-level validation error. */
export interface PropError {
  prop: string;
  code: 'REQUIRED' | 'TYPE' | 'ENUM' | 'UNKNOWN_PROPERTY';
  detail: string;
}

/** Validation outcome. */
export interface PropValidation {
  props: Record<string, unknown>;
  errors: PropError[];
}

function coerce(
  value: unknown,
  type: DataType,
  def: PropertyDef,
): {ok: boolean; value: unknown} {
  if (value === null || value === undefined || value === '')
    return {ok: true, value: null};
  switch (type) {
    case 'string':
      return {ok: true, value: String(value)};
    case 'integer': {
      const n =
        typeof value === 'number'
          ? value
          : Number(String(value).replace(/,/g, ''));
      return Number.isFinite(n)
        ? {ok: true, value: Math.trunc(n)}
        : {ok: false, value};
    }
    case 'double': {
      const n =
        typeof value === 'number'
          ? value
          : Number(String(value).replace(/,/g, ''));
      return Number.isFinite(n) ? {ok: true, value: n} : {ok: false, value};
    }
    case 'boolean': {
      if (typeof value === 'boolean') return {ok: true, value};
      const s = String(value).toLowerCase();
      if (['true', '1', 'yes', 'y'].includes(s)) return {ok: true, value: true};
      if (['false', '0', 'no', 'n'].includes(s))
        return {ok: true, value: false};
      return {ok: false, value};
    }
    case 'date':
    case 'timestamp': {
      const d = new Date(value as string | number);
      if (Number.isNaN(d.getTime())) return {ok: false, value};
      return {
        ok: true,
        value: type === 'date' ? d.toISOString().slice(0, 10) : d.toISOString(),
      };
    }
    case 'geopoint': {
      if (
        typeof value === 'object' &&
        value &&
        'lat' in value &&
        'lon' in value
      ) {
        return {ok: true, value};
      }
      const m = String(value).match(
        /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/,
      );
      return m
        ? {ok: true, value: {lat: Number(m[1]), lon: Number(m[2])}}
        : {ok: false, value};
    }
    case 'enum': {
      const s = String(value);
      return {ok: !def.enumValues || def.enumValues.includes(s), value: s};
    }
    default:
      // objectRef:<Type> — stored as the referenced primary key or RID.
      return {ok: true, value: String(value)};
  }
}

/**
 * Validates and coerces properties. Unknown properties are dropped (and
 * reported only when `strict`).
 */
export function validateProps(
  type: CompiledObjectType,
  input: Record<string, unknown>,
  opts: {strict?: boolean; partial?: boolean} = {},
): PropValidation {
  const props: Record<string, unknown> = {};
  const errors: PropError[] = [];
  for (const def of type.properties) {
    const has = Object.prototype.hasOwnProperty.call(input, def.apiName);
    if (!has && opts.partial) continue;
    const {ok, value} = coerce(input[def.apiName], def.dataType, def);
    if (!ok) {
      errors.push({
        prop: def.apiName,
        code: def.dataType === 'enum' ? 'ENUM' : 'TYPE',
        detail: `Expected ${def.dataType}`,
      });
      continue;
    }
    if ((value === null || value === undefined) && def.required) {
      errors.push({
        prop: def.apiName,
        code: 'REQUIRED',
        detail: 'Value is required',
      });
      continue;
    }
    if (value !== null && value !== undefined) props[def.apiName] = value;
  }
  if (opts.strict) {
    for (const key of Object.keys(input)) {
      if (!type.propsByName[key]) {
        errors.push({
          prop: key,
          code: 'UNKNOWN_PROPERTY',
          detail: 'Not defined in schema',
        });
      }
    }
  }
  return {props, errors};
}

/** Returns the value used for og_prop_index (num or str column). */
export function indexValue(value: unknown): {
  num: number | null;
  str: string | null;
} {
  if (typeof value === 'number') return {num: value, str: null};
  if (typeof value === 'boolean') return {num: value ? 1 : 0, str: null};
  if (value === null || value === undefined) return {num: null, str: null};
  return {
    num: null,
    str: typeof value === 'string' ? value : JSON.stringify(value),
  };
}
