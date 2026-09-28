/**
 * @fileoverview Tests of the read projection, declarative functions,
 * titles and index entries.
 */

import {describe, expect, it} from 'vitest';
import type {
  CompiledObjectType,
  CompiledSchema,
  FunctionDef,
  PropertyDef,
} from '@ontodecide/ontology/contract';
import {
  deriveValues,
  indexEntries,
  projectProps,
  titleOf,
  valueMatches,
} from './stored_object';

const def = (
  dataType: PropertyDef['dataType'],
  extra: Partial<PropertyDef> = {},
) => ({apiName: 'p', displayName: 'p', dataType, ...extra}) as PropertyDef;

const type = {
  apiName: 'T',
  displayName: 'T',
  primaryKey: 'id',
  titleProperty: 'name',
  properties: [def('string'), def('integer')],
  propsByName: {
    id: def('string'),
    name: def('string'),
    n: def('integer'),
    flag: def('boolean'),
    geo: def('geopoint'),
  },
  indexedProps: ['n', 'flag', 'geo', 'name'],
  sensitiveProps: [],
} as unknown as CompiledObjectType;

describe('valueMatches', () => {
  it('checks each data type', () => {
    expect(valueMatches(def('string'), 'a')).toBe(true);
    expect(valueMatches(def('string'), 1)).toBe(false);
    expect(valueMatches(def('integer'), 2)).toBe(true);
    expect(valueMatches(def('integer'), 2.5)).toBe(false);
    expect(valueMatches(def('double'), 2.5)).toBe(true);
    expect(valueMatches(def('boolean'), 'true')).toBe(false);
    expect(valueMatches(def('date'), '2026-01-02')).toBe(true);
    expect(valueMatches(def('date'), '2026-01-02T00:00:00Z')).toBe(false);
    expect(valueMatches(def('timestamp'), '2026-01-02T00:00:00Z')).toBe(true);
    expect(valueMatches(def('geopoint'), {lat: 1, lon: 2})).toBe(true);
    expect(valueMatches(def('geopoint'), '1,2')).toBe(false);
    expect(valueMatches(def('enum', {enumValues: ['A']}), 'B')).toBe(false);
    expect(valueMatches(def('objectRef:X'), 'ri.X.1')).toBe(true);
  });
});

describe('projectProps', () => {
  it('drops unknown props and lists invalid ones', () => {
    const p = projectProps(
      type,
      {id: 'x', n: 'seven', ghost: 1, name: null},
      {n: {jobId: 'j', row: 1, at: 1}, ghost: {jobId: 'j', row: 1, at: 1}},
    );
    expect(p.props).toEqual({id: 'x', n: 'seven'});
    expect(Object.keys(p.provenance)).toEqual(['n']);
    expect(p.invalidProps).toEqual(['n']);
    expect(projectProps(undefined, {a: 1}, {}).props).toEqual({});
  });
});

describe('titles and index rows', () => {
  it('falls back to the primary key', () => {
    expect(titleOf(type, {name: 'Acme'}, 'K')).toBe('Acme');
    expect(titleOf(type, {}, 'K')).toBe('K');
  });

  it('indexes scalar values of indexed props only', () => {
    expect(
      indexEntries(type, {n: 3, flag: false, geo: {lat: 1, lon: 2}, id: 'x'}),
    ).toEqual([
      {prop: 'n', value: 3},
      {prop: 'flag', value: 0},
      {prop: 'geo', value: '{"lat":1,"lon":2}'},
    ]);
  });
});

/** The two functions of the supply-chain template (packs/supply_chain.ts). */
const SUPPLY_CHAIN_FUNCTIONS: FunctionDef[] = [
  {
    apiName: 'supplierRiskLevel',
    objectType: 'Supplier',
    expr: {
      if: [
        {'>=': [{var: 'riskScore'}, 70]},
        'HIGH',
        {'>=': [{var: 'riskScore'}, 40]},
        'MEDIUM',
        'LOW',
      ],
    },
    returns: 'string',
  },
  {
    apiName: 'stockCoverage',
    objectType: 'Material',
    expr: {'/': [{var: 'stock'}, {var: 'safetyStock'}]},
    returns: 'double',
  },
];

function schemaWith(fns: FunctionDef[]): CompiledSchema {
  return {
    functions: Object.fromEntries(fns.map(f => [f.apiName, f])),
  } as unknown as CompiledSchema;
}

describe('deriveValues', () => {
  const schema = schemaWith(SUPPLY_CHAIN_FUNCTIONS);

  it('evaluates the functions bound to the object type', () => {
    expect(deriveValues(schema, 'Supplier', {riskScore: 82})).toEqual({
      supplierRiskLevel: 'HIGH',
    });
    expect(deriveValues(schema, 'Supplier', {riskScore: 45})).toEqual({
      supplierRiskLevel: 'MEDIUM',
    });
    expect(deriveValues(schema, 'Supplier', {riskScore: 3})).toEqual({
      supplierRiskLevel: 'LOW',
    });
    expect(
      deriveValues(schema, 'Material', {stock: 150, safetyStock: 100}),
    ).toEqual({stockCoverage: 1.5});
  });

  it('returns null for division by zero, missing inputs and failures', () => {
    expect(
      deriveValues(schema, 'Material', {stock: 5, safetyStock: 0}),
    ).toEqual({stockCoverage: null});
    const broken = schemaWith([
      {
        apiName: 'bad',
        objectType: 'Supplier',
        expr: {eval: ['x']} as never,
        returns: 'string',
      },
      {
        apiName: 'heavy',
        objectType: 'Supplier',
        // 2,000 nested additions exceed the 1,000-step limit.
        expr: Array.from({length: 2000}).reduce<unknown>(
          acc => ({'+': [acc, 1]}),
          0,
        ) as never,
        returns: 'double',
      },
    ]);
    expect(deriveValues(broken, 'Supplier', {})).toEqual({
      bad: null,
      heavy: null,
    });
  });

  it('omits derived values for types without functions', () => {
    expect(deriveValues(schema, 'Part', {stock: 1})).toBeUndefined();
    expect(deriveValues(schemaWith([]), 'Supplier', {})).toBeUndefined();
  });
});
