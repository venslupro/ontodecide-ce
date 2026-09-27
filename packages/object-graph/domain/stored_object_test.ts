/**
 * @fileoverview Tests of the read projection, titles and index entries.
 */

import {describe, expect, it} from 'vitest';
import type {
  CompiledObjectType,
  PropertyDef,
} from '@ontodecide/ontology/contract';
import {
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
