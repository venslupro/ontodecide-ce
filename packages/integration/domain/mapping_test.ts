/**
 * @fileoverview Tests for the mapping engine using the supply-chain sample.
 */

import {describe, expect, it} from 'vitest';
import type {MappingSpec} from '../contract';
import {mapRecord, validateMapping} from './mapping';
import {
  readSampleCsv,
  SUPPLIER_MAPPING,
  supplyChainModel,
} from './supply_chain_fixture';

const model = supplyChainModel();
const now = new Date('2026-09-24T00:00:00Z');
const ctx = (mapping: MappingSpec = SUPPLIER_MAPPING, qualityRules = []) => ({
  mapping,
  qualityRules,
  targetType: model.objectTypes[mapping.targetType],
  now,
  provenance: {
    sourceId: 'src1',
    datasetTxn: 'job1',
    ingestedAt: now.toISOString(),
    confidence: 1,
    priority: 5,
  },
});

describe('mapRecord', () => {
  const rows = readSampleCsv('suppliers.csv');

  it('maps every supplier row into an UpsertCmd with links', () => {
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const results = rows.map((r, i) => mapRecord(r, i + 1, ctx()));
    expect(results.every(r => r.ok)).toBe(true);
    const first = results[0];
    if (!first.ok) throw new Error('unexpected');
    expect(first.cmd).toEqual({
      type: 'Supplier',
      primaryKey: 'S-001',
      props: {
        supplierId: 'S-001',
        name: 'Shenzhen Precision Parts',
        country: 'CN',
        riskScore: 35,
        capacity: 1200,
        onTimeRate: 0.96,
        status: 'active',
        contactEmail: 'ops@szpp.example',
      },
      links: [
        {type: 'supplies', toType: 'Material', toKey: 'M-100', weight: 0.7},
        {type: 'supplies', toType: 'Material', toKey: 'M-101', weight: 0.7},
      ],
      provenance: {
        sourceId: 'src1',
        datasetTxn: 'job1',
        recordRef: 'job1:1',
        ingestedAt: now.toISOString(),
        confidence: 1,
        priority: 5,
      },
      row: 1,
    });
    const s4 = results[3];
    expect(s4.ok && s4.cmd.links).toEqual([
      {type: 'supplies', toType: 'Material', toKey: 'M-103', weight: 1},
    ]);
  });

  it('rejects missing primary keys, bad transforms and invalid props', () => {
    const row = rows[0];
    expect(mapRecord({...row, supplierId: ' '}, 7, ctx())).toMatchObject({
      ok: false,
      rejection: {row: 7, code: 'PRIMARY_KEY_MISSING'},
    });
    expect(mapRecord({...row, riskScore: 'high'}, 8, ctx())).toMatchObject({
      ok: false,
      rejection: {code: 'TRANSFORM_FAILED'},
    });
    expect(mapRecord({...row, status: 'retired'}, 9, ctx())).toMatchObject({
      ok: false,
      rejection: {code: 'PROP_INVALID'},
    });
    expect(mapRecord({...row, name: ''}, 10, ctx())).toMatchObject({
      ok: false,
      rejection: {code: 'PROP_INVALID'},
    });
    expect(mapRecord({...row, share: 'lots'}, 11, ctx())).toMatchObject({
      ok: false,
      rejection: {code: 'TRANSFORM_FAILED'},
    });
  });

  it('clamps via transforms and applies quality rules', () => {
    const r = mapRecord({...rows[0], riskScore: '150'}, 1, ctx());
    expect(r.ok && r.cmd.props.riskScore).toBe(100);
    const rejected = mapRecord({...rows[0], onTimeRate: '1.5'}, 1, {
      ...ctx(),
      qualityRules: [
        {prop: 'onTimeRate', kind: 'range', arg: [0, 1], onFail: 'reject'},
      ],
    } as never);
    expect(rejected).toMatchObject({
      ok: false,
      rejection: {code: 'QUALITY_FAILED'},
    });
  });

  it('extracts sourceTs and external keys', () => {
    const mapping: MappingSpec = {
      ...SUPPLIER_MAPPING,
      primaryKey: {from: 'supplierId', transform: 'trim|upper'},
      sourceTsFrom: 'updated',
    };
    const r = mapRecord(
      {...rows[0], supplierId: 's-001', updated: '2026-09-20'},
      1,
      ctx(mapping),
    );
    expect(r.ok && r.cmd.primaryKey).toBe('S-001');
    expect(r.ok && r.cmd.externalKey).toBe('s-001');
    expect(r.ok && r.cmd.provenance.sourceTs).toBe('2026-09-20T00:00:00.000Z');
  });

  it('validates mappings', () => {
    expect(() => validateMapping(SUPPLIER_MAPPING, [], model)).not.toThrow();
    expect(() =>
      validateMapping({...SUPPLIER_MAPPING, targetType: 'Nope'}, [], model),
    ).toThrow();
    expect(() =>
      validateMapping({
        ...SUPPLIER_MAPPING,
        fields: [{to: 'x', from: 'y', transform: 'boom'}],
      }),
    ).toThrow(/Unknown transform/);
  });
});
