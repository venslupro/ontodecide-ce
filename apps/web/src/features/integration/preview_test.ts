/**
 * @fileoverview Client row checks mirror the server (required, type,
 * primary key empty / duplicate, transform failures), the upload plan
 * (remaining import rows, object headroom, over-limit rows) and the
 * projection onto mapped columns.
 */

import type {MappingSpec} from '@ontodecide/integration/contract';
import {describe, expect, it} from 'vitest';
import {toUiModel} from '../../entities/schema/model';
import {ontologyDto} from '../../test/fixtures/business';
import {
  mapRowsPreview,
  planUpload,
  projectRows,
  rowLinkCounts,
  rowsWithinLinks,
  validateRows,
} from './preview';

const supplier = toUiModel(ontologyDto, 'zh-CN').byName.Supplier;
const SPEC: MappingSpec = {
  targetType: 'Supplier',
  primaryKey: {from: 'code', transform: 'trim'},
  fields: [
    {to: 'supplierId', from: 'code', transform: 'trim'},
    {to: 'name', from: 'n', transform: 'trim'},
    {to: 'riskScore', from: 'risk', transform: 'trim|toNumber|clamp(0,100)'},
    {to: 'status', from: 'st'},
  ],
};

describe('mapRowsPreview', () => {
  it('transforms and coerces values', () => {
    const [o] = mapRowsPreview(
      [{code: ' S-1 ', n: ' Alpha ', risk: '182', st: 'active'}],
      SPEC,
      supplier,
    );
    expect(o).toEqual({
      ok: true,
      row: 1,
      primaryKey: 'S-1',
      props: {
        supplierId: 'S-1',
        name: 'Alpha',
        riskScore: 100,
        status: 'active',
      },
      linkCount: 0,
    });
  });

  it('rejects with the first failing check and never the cell value', () => {
    const out = mapRowsPreview(
      [
        {code: '', n: 'x'},
        {code: 'S-1', n: 'a'},
        {code: 'S-1', n: 'b'},
        {code: 'S-2', n: ''},
        {code: 'S-3', n: 'c', risk: 'high'},
        {code: 'S-4', n: 'd', st: 'unknown'},
      ],
      SPEC,
      supplier,
    );
    expect(out.map(o => (o.ok ? 'ok' : o.code))).toEqual([
      'PRIMARY_KEY_MISSING',
      'ok',
      'PRIMARY_KEY_CONFLICT',
      'REQUIRED',
      'TRANSFORM_FAILED',
      'TYPE',
    ]);
    expect(out[3]).toMatchObject({row: 4, column: 'n'});
    expect(out[4]).toMatchObject({column: 'risk'});
    expect(JSON.stringify(out[4])).not.toContain('high');
  });

  it('counts link keys', () => {
    const spec = {
      ...SPEC,
      links: [
        {type: 'supplies', toType: 'Material', toKey: 'skus', split: ','},
      ],
    };
    const [o] = mapRowsPreview(
      [{code: 'S', n: 'N', skus: 'M-1, M-2,'}],
      spec,
      supplier,
    );
    expect(o).toMatchObject({ok: true, linkCount: 2});
  });
});

describe('planUpload', () => {
  it('submits everything within the limits in batches of 100', () => {
    expect(planUpload(212, {importRowsLeft: 1180, objectsLeft: 289})).toEqual({
      totalRows: 212,
      submitRows: 212,
      overLimitRows: 0,
      limitedBy: null,
      batches: 3,
      batchRows: 100,
      estimatedSeconds: 3,
    });
  });

  it('marks rows beyond the remaining import rows or object headroom', () => {
    expect(
      planUpload(500, {importRowsLeft: 120, objectsLeft: 289}),
    ).toMatchObject({
      submitRows: 120,
      overLimitRows: 380,
      limitedBy: 'importRows',
      batches: 2,
    });
    expect(
      planUpload(500, {importRowsLeft: 2000, objectsLeft: 289}),
    ).toMatchObject({
      submitRows: 289,
      limitedBy: 'objects',
    });
    expect(
      planUpload(5000, {importRowsLeft: 9999, objectsLeft: 9999}),
    ).toMatchObject({
      submitRows: 2000,
      limitedBy: 'batchMax',
      batches: 20,
    });
    expect(planUpload(10, {importRowsLeft: 0, objectsLeft: 5})).toMatchObject({
      submitRows: 0,
      batches: 0,
      estimatedSeconds: 0,
    });
  });
});

describe('link headroom (前端 预检额度: min(导入行, 对象, 关系))', () => {
  const spec = {
    links: [{type: 'supplies', toType: 'Material', toKey: 'skus', split: ';'}],
  };
  const rows = [{skus: 'M1;M2;M3'}, {skus: 'M4'}, {skus: ''}, {skus: 'M5;M6'}];

  it('counts the links each row would create', () => {
    expect(rowLinkCounts(rows, spec)).toEqual([3, 1, 0, 2]);
    expect(rowLinkCounts(rows, {})).toEqual([]);
    expect(rowsWithinLinks([3, 1, 0, 2], 4)).toBe(3);
    expect(rowsWithinLinks([3, 1, 0, 2], 2)).toBe(0);
    expect(rowsWithinLinks([3, 1, 0, 2], 100)).toBe(4);
  });

  it('caps the plan by the links left when the mapping has links', () => {
    const counts = rowLinkCounts(rows, spec);
    expect(
      planUpload(
        4,
        {importRowsLeft: 100, objectsLeft: 100, linksLeft: 4},
        100,
        counts,
      ),
    ).toMatchObject({submitRows: 3, overLimitRows: 1, limitedBy: 'links'});
    // Import rows still win when they are tighter.
    expect(
      planUpload(
        4,
        {importRowsLeft: 1, objectsLeft: 100, linksLeft: 4},
        100,
        counts,
      ),
    ).toMatchObject({submitRows: 1, limitedBy: 'importRows'});
    // Without links in the mapping the link headroom is ignored.
    expect(
      planUpload(4, {importRowsLeft: 100, objectsLeft: 100, linksLeft: 0}),
    ).toMatchObject({submitRows: 4, limitedBy: null});
  });
});

describe('validateRows / projectRows', () => {
  it('summarizes pass / reject / over-limit', () => {
    const rows = [
      {code: 'A', n: 'a'},
      {code: '', n: 'b'},
      {code: 'C', n: 'c'},
      {code: 'D', n: 'd'},
    ];
    const s = validateRows(rows, SPEC, supplier, {submitRows: 3});
    expect(s.passed).toBe(2);
    expect(s.rejected).toBe(1);
    expect(s.overLimit).toBe(1);
    expect(s.byCode).toEqual({PRIMARY_KEY_MISSING: 1});
    expect(s.rejects).toEqual([
      {row: 2, code: 'PRIMARY_KEY_MISSING', column: 'code'},
    ]);
  });

  it('keeps only mapped columns', () => {
    expect(projectRows([{a: 1, b: 2, secret: 'x'}], ['a', 'b', 'c'])).toEqual([
      {a: 1, b: 2},
    ]);
  });
});
