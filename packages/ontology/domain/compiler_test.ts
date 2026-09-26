/**
 * @fileoverview Tests for the compiler, model merge and function evaluation.
 */

import {AppError} from '@ontodecide/shared-kernel';
import {describe, expect, it} from 'vitest';
import type {SchemaDef} from '../contract';
import {compileSchema, indexChanges} from './compiler';
import {evaluateFunction} from './functions';
import {EMPTY_MODEL_VERSION, mergeModel} from './model';
import {SUPPLY_CHAIN_PACK} from './packs/supply_chain';

const base = (): SchemaDef => structuredClone(SUPPLY_CHAIN_PACK.schema);

function other(): SchemaDef {
  return {
    apiName: 'maintenance',
    displayName: 'Maintenance',
    objectTypes: [
      {
        apiName: 'Machine',
        displayName: 'Machine',
        primaryKey: 'machineId',
        titleProperty: 'machineId',
        properties: [
          {
            apiName: 'machineId',
            displayName: 'ID',
            dataType: 'string',
            indexed: true,
          },
          {
            apiName: 'healthy',
            displayName: 'Healthy',
            dataType: 'boolean',
            indexed: true,
          },
        ],
      },
    ],
    linkTypes: [],
    actionTypes: [],
    functions: [],
  };
}

describe('compileSchema', () => {
  it('derives lookups, index plan and sensitive props', async () => {
    const c = await compileSchema(base(), '1.0.0');
    expect(c.apiName).toBe('supplyChain');
    expect(c.version).toBe('1.0.0');
    const supplier = c.objectTypes.Supplier;
    expect(supplier.schemaApi).toBe('supplyChain');
    expect(supplier.propsByName.riskScore.dataType).toBe('double');
    expect(supplier.indexedProps).toEqual([
      'name',
      'country',
      'riskScore',
      'capacity',
      'status',
    ]);
    expect(supplier.sensitiveProps).toEqual(['contactEmail']);
    expect(c.indexPlan).toContainEqual({
      objectType: 'Supplier',
      prop: 'riskScore',
      kind: 'num',
    });
    expect(c.indexPlan).toContainEqual({
      objectType: 'Supplier',
      prop: 'status',
      kind: 'str',
    });
    expect(c.indexPlan).toContainEqual({
      objectType: 'Product',
      prop: 'dailyDemand',
      kind: 'num',
    });
    expect(Object.keys(c.linkTypes)).toEqual(['supplies', 'usedIn']);
    expect(Object.keys(c.actionTypes)).toHaveLength(3);
    expect(Object.keys(c.functions)).toEqual([
      'supplierRiskLevel',
      'coverageDays',
    ]);
    expect(c.simulationKpis).toHaveLength(2);
    const m = await compileSchema(other(), '1.0.0');
    expect(m.indexPlan).toContainEqual({
      objectType: 'Machine',
      prop: 'healthy',
      kind: 'num',
    });
  });

  it('hash is stable across key order and sensitive to content', async () => {
    const a = await compileSchema(base(), '1.0.0');
    const reordered = Object.fromEntries(
      Object.entries(base()).reverse(),
    ) as unknown as SchemaDef;
    const b = await compileSchema(reordered, '1.0.0');
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.hash).toBe(a.hash);
    const changed = base();
    changed.displayName = 'Changed';
    expect((await compileSchema(changed, '1.0.0')).hash).not.toBe(a.hash);
  });

  it('indexChanges lists new index entries only', async () => {
    const prev = (await compileSchema(base(), '1.0.0')).indexPlan;
    const def = base();
    def.objectTypes[0].properties[5].indexed = true; // onTimeRate
    const next = (await compileSchema(def, '1.1.0')).indexPlan;
    expect(indexChanges(prev, next)).toEqual([
      {objectType: 'Supplier', prop: 'onTimeRate', kind: 'num'},
    ]);
    expect(indexChanges([], next)).toHaveLength(next.length);
  });
});

describe('mergeModel', () => {
  it('returns an empty model with version 0 for an empty tenant', async () => {
    const m = await mergeModel('t1', []);
    expect(m).toMatchObject({
      tenantId: 't1',
      version: EMPTY_MODEL_VERSION,
      schemas: [],
      objectTypes: {},
      indexPlan: [],
    });
    expect(m.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('merges schemas sorted by api name', async () => {
    const sc = await compileSchema(base(), '1.0.0');
    const mt = await compileSchema(other(), '2.1.0');
    const m = await mergeModel('t1', [sc, mt]);
    expect(m.version).toBe('maintenance@2.1.0+supplyChain@1.0.0');
    expect(m.schemas).toEqual([
      {apiName: 'maintenance', version: '2.1.0'},
      {apiName: 'supplyChain', version: '1.0.0'},
    ]);
    expect(Object.keys(m.objectTypes).sort()).toEqual([
      'Machine',
      'Material',
      'Product',
      'Supplier',
    ]);
    expect(m.objectTypes.Machine.schemaApi).toBe('maintenance');
    expect(m.indexPlan.length).toBe(sc.indexPlan.length + mt.indexPlan.length);
    expect(m.functions.coverageDays).toBeDefined();
    expect((await mergeModel('t1', [mt, sc])).hash).toBe(m.hash);
  });
});

describe('evaluateFunction', () => {
  const fns = base().functions;
  const riskLevel = fns.find(f => f.apiName === 'supplierRiskLevel')!;
  const coverage = fns.find(f => f.apiName === 'coverageDays')!;

  it('evaluates supplierRiskLevel', () => {
    expect(evaluateFunction(riskLevel, {riskScore: 85})).toBe('HIGH');
    expect(evaluateFunction(riskLevel, {riskScore: 70})).toBe('HIGH');
    expect(evaluateFunction(riskLevel, {riskScore: 55})).toBe('MEDIUM');
    expect(evaluateFunction(riskLevel, {riskScore: 10})).toBe('LOW');
  });

  it('evaluates coverageDays', () => {
    expect(
      evaluateFunction(coverage, {inventoryDays: 12, safetyStockDays: 5}),
    ).toBe(7);
  });

  it('enforces the step cap', () => {
    let expr: unknown = 1;
    for (let i = 0; i < 1100; i++) expr = {'+': [expr, 1]};
    const fn = {
      apiName: 'deep',
      expr: expr as never,
      returns: 'double' as const,
    };
    expect(() => evaluateFunction(fn, {})).toThrow(AppError);
  });
});
