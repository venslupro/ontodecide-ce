/**
 * @fileoverview Tests for the mapping heuristic and LLM output validation.
 */

import {describe, expect, it} from 'vitest';
import type {TargetProp} from '../contract';
import {heuristicMapping, nameSimilarity, validateMapping} from './mapping';
import {supplyChainModel} from './testing/supply_chain_fixture';

const model = supplyChainModel();
const supplierProps: TargetProp[] = model.objectTypes.Supplier.properties.map(
  p => ({
    apiName: p.apiName,
    dataType: p.dataType,
    displayName:
      typeof p.displayName === 'string'
        ? p.displayName
        : p.displayName['en-US'],
  }),
);
const FIELDS = [
  'supplierId',
  'name',
  'country',
  'riskScore',
  'capacity',
  'onTimeRate',
  'status',
  'contactEmail',
  'materials',
  'share',
];

describe('nameSimilarity', () => {
  it('scores exact, normalized and partial matches', () => {
    expect(nameSimilarity('risk_score', 'riskScore')).toBe(1);
    expect(nameSimilarity('Supplier ID', 'supplierId')).toBe(1);
    expect(nameSimilarity('email', 'contactEmail')).toBeGreaterThan(0.6);
    expect(nameSimilarity('share', 'capacity')).toBeLessThan(0.5);
  });
});

describe('heuristicMapping', () => {
  it('maps suppliers.csv headers onto Supplier', () => {
    const m = heuristicMapping({
      fields: FIELDS,
      rows: [],
      targetType: 'Supplier',
      targetProps: supplierProps,
    });
    expect(m.model).toBe('rules');
    expect(m.primaryKey).toEqual({from: 'supplierId'});
    const byTo = Object.fromEntries(m.fields.map(f => [f.to, f]));
    for (const p of [
      'supplierId',
      'name',
      'country',
      'riskScore',
      'capacity',
      'onTimeRate',
      'status',
      'contactEmail',
    ]) {
      expect(byTo[p]?.from).toBe(p);
      expect(byTo[p]?.confidence).toBe(1);
    }
    expect(m.fields.map(f => f.from)).not.toContain('share');
  });

  it('matches display names and fuzzy headers', () => {
    const m = heuristicMapping({
      fields: ['Supplier Code', 'Supplier Name', 'Risk', 'e-mail'],
      rows: [],
      targetType: 'Supplier',
      targetProps: supplierProps,
    });
    const byTo = Object.fromEntries(m.fields.map(f => [f.to, f.from]));
    expect(byTo.name).toBe('Supplier Name');
    expect(byTo.riskScore).toBe('Risk');
    for (const f of m.fields) expect(f.confidence).toBeGreaterThanOrEqual(0.5);
    expect(m.primaryKey.from).toBeTruthy();
  });
});

describe('validateMapping', () => {
  const sample = {
    fields: FIELDS,
    rows: [],
    targetType: 'Supplier',
    targetProps: supplierProps,
  };
  it('accepts whitelisted output', () => {
    const v = validateMapping(
      JSON.stringify({
        primaryKey: {from: 'supplierId'},
        fields: [{to: 'name', from: 'name', confidence: 0.9}],
      }),
      sample,
      'm',
    );
    expect(v).toEqual({
      ok: true,
      value: {
        targetType: 'Supplier',
        primaryKey: {from: 'supplierId'},
        fields: [{to: 'name', from: 'name', confidence: 0.9}],
        model: 'm',
      },
    });
  });
  it('rejects unknown fields and targets', () => {
    expect(
      validateMapping(
        JSON.stringify({primaryKey: {from: 'nope'}, fields: []}),
        sample,
        'm',
      ).ok,
    ).toBe(false);
    expect(
      validateMapping(
        JSON.stringify({
          primaryKey: {from: 'supplierId'},
          fields: [{to: 'bogus', from: 'name', confidence: 1}],
        }),
        sample,
        'm',
      ).ok,
    ).toBe(false);
    expect(validateMapping('garbage', sample, 'm').ok).toBe(false);
  });
});
