/**
 * @fileoverview Tests for mapping validation and the row checks.
 */

import {AppError} from '@ontodecide/shared-kernel';
import {describe, expect, it} from 'vitest';
import type {MappingSpec} from '../contract';
import {assertMapping, mapRows, mappingIssues, objectKey} from './mapping';
import {supplyChainSchema} from './schema_fixture';

const schema = supplyChainSchema();
const supplier = schema.objectTypes.Supplier;

const SPEC: MappingSpec = {
  targetType: 'Supplier',
  primaryKey: {from: 'id', transform: 'trim|upper'},
  fields: [
    {to: 'name', from: 'Name', transform: 'trim'},
    {to: 'riskScore', from: 'risk', transform: 'trim|toNumber|clamp(0,100)'},
    {to: 'status', from: 'state', transform: 'trim|lower'},
  ],
  links: [
    {
      type: 'supplies',
      toType: 'Material',
      toKey: 'materials',
      split: ';',
      weightFrom: 'share',
    },
  ],
};

const run = (rows: Record<string, unknown>[], seen = new Set<string>()) =>
  mapRows({rows, firstRow: 1, mapping: SPEC, type: supplier, seen});

describe('mappingIssues', () => {
  it('accepts a valid mapping', () => {
    expect(mappingIssues(SPEC, schema)).toEqual([]);
    expect(assertMapping(SPEC, schema)).toBe(supplier);
  });

  it('reports unknown types, properties, links and transforms', () => {
    expect(mappingIssues({...SPEC, targetType: 'Nope'}, schema)).toHaveLength(
      1,
    );
    const bad: MappingSpec = {
      ...SPEC,
      primaryKey: {from: 'id', transform: 'explode'},
      fields: [
        {to: 'name', from: 'a'},
        {to: 'name', from: 'b'},
        {to: 'ghost', from: 'c'},
        {
          to: 'riskScore',
          from: 'd',
          transform: 'trim|trim|trim|trim|trim|trim',
        },
      ],
      links: [
        {type: 'usedIn', toType: 'Product', toKey: 'p'},
        {type: 'nope', toType: 'X', toKey: 'x'},
      ],
    };
    const paths = mappingIssues(bad, schema).map(i => i.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'primaryKey.transform',
        'fields.1.to',
        'fields.2.to',
        'fields.3.transform',
        'links.0.toType',
        'links.1.type',
      ]),
    );
  });

  it('requires every required property to be mapped', () => {
    const spec: MappingSpec = {...SPEC, fields: SPEC.fields.slice(1)};
    expect(mappingIssues(spec, schema)).toEqual([
      {path: 'fields', message: 'Required property name'},
    ]);
    try {
      assertMapping(spec, schema);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('VALIDATION_FAILED');
      expect((e as AppError).extras.errors).toHaveLength(1);
    }
  });
});

describe('mapRows', () => {
  it('maps rows, coerces props and builds links with split and weight', () => {
    const out = run([
      {
        id: ' s-1 ',
        Name: ' Acme ',
        risk: '120',
        state: 'ACTIVE',
        materials: 'M-1; M-2',
        share: '70%',
      },
    ]);
    expect(out.rejects).toEqual([]);
    expect(out.keys).toEqual([objectKey('Supplier', 'S-1')]);
    expect(out.cmds).toEqual([
      {
        type: 'Supplier',
        primaryKey: 'S-1',
        row: 1,
        props: {
          supplierId: 'S-1',
          name: 'Acme',
          riskScore: 100,
          status: 'active',
        },
        links: [
          {type: 'supplies', toType: 'Material', toKey: 'M-1', weight: 0.7},
          {type: 'supplies', toType: 'Material', toKey: 'M-2', weight: 0.7},
        ],
      },
    ]);
  });

  it('rejects with column and code only, never the value', () => {
    const out = run([
      {id: '', Name: 'x'},
      {id: 'S-2', Name: ''},
      {id: 'S-3', Name: 'x', risk: 'high'},
      {id: 'S-4', Name: 'x', state: 'unknown'},
      {id: 'S-5', Name: 'x', share: 'lots', materials: 'M-1'},
    ]);
    expect(out.cmds).toEqual([]);
    expect(out.rejects).toEqual([
      {row: 1, code: 'PRIMARY_KEY_MISSING', column: 'id'},
      {row: 2, code: 'REQUIRED', column: 'Name', detail: 'Value is required'},
      {row: 3, code: 'TRANSFORM_FAILED', column: 'risk', detail: 'toNumber'},
      {row: 4, code: 'TYPE', column: 'state', detail: 'Expected enum'},
      {row: 5, code: 'TYPE', column: 'share', detail: 'weight'},
    ]);
    expect(JSON.stringify(out.rejects)).not.toMatch(/high|unknown|lots/);
  });

  it('detects primary-key conflicts within the batch and the job', () => {
    const out = run(
      [
        {id: 'S-1', Name: 'a'},
        {id: 's-1', Name: 'b'},
        {id: 'S-2', Name: 'c'},
      ],
      new Set([objectKey('Supplier', 'S-2')]),
    );
    expect(out.cmds.map(c => c.primaryKey)).toEqual(['S-1']);
    expect(out.rejects.map(r => [r.row, r.code])).toEqual([
      [2, 'PRIMARY_KEY_CONFLICT'],
      [3, 'PRIMARY_KEY_CONFLICT'],
    ]);
  });

  it('a rejected first occurrence does not block a later valid row', () => {
    const out = run([
      {id: 'S-1', Name: ''},
      {id: 'S-1', Name: 'ok'},
    ]);
    expect(out.rejects.map(r => r.code)).toEqual(['REQUIRED']);
    expect(out.cmds[0].row).toBe(2);
  });

  it('numbers rows from firstRow', () => {
    const out = mapRows({
      rows: [{id: 'A', Name: 'a'}],
      firstRow: 101,
      mapping: SPEC,
      type: supplier,
      seen: new Set(),
    });
    expect(out.cmds[0].row).toBe(101);
  });
});
