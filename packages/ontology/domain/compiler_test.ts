/**
 * @fileoverview Tests of the ontology compiler, definition operations and
 * function evaluation.
 */

import {describe, expect, it} from 'vitest';
import type {LinkTypeDef} from '../contract';
import {compileOntology, withMeta} from './compiler';
import {evaluateFunction} from './functions';
import {
  emptyOntology,
  findDef,
  isDefKind,
  listOf,
  normalizeOntology,
  putDef,
  removeDef,
} from './model';
import {SUPPLY_CHAIN_DEFINITION} from './packs/supply_chain';

const META = {
  templateId: 'supply-chain',
  templateVersion: '1.0.0',
  custom: false,
  etag: 0,
};

describe('compileOntology', () => {
  const compiled = compileOntology(SUPPLY_CHAIN_DEFINITION, META);

  it('builds property lookups and indexed / sensitive lists', () => {
    const supplier = compiled.objectTypes.Supplier;
    expect(supplier.propsByName.riskScore.dataType).toBe('double');
    expect(supplier.indexedProps).toEqual([
      'name',
      'country',
      'riskScore',
      'capacity',
      'onTimeRate',
      'status',
    ]);
    expect(supplier.sensitiveProps).toEqual(['contactEmail']);
    expect(compiled.objectTypes.Material.sensitiveProps).toEqual([]);
  });

  it('derives the index plan from indexed properties', () => {
    expect(compiled.indexPlan).toContainEqual({
      objectType: 'Material',
      prop: 'safetyStock',
    });
    const total = SUPPLY_CHAIN_DEFINITION.objectTypes.flatMap(t =>
      t.properties.filter(p => p.indexed),
    ).length;
    expect(compiled.indexPlan).toHaveLength(total);
  });

  it('keys link, action and function definitions by api name', () => {
    expect(Object.keys(compiled.linkTypes)).toEqual(['supplies', 'usedIn']);
    expect(compiled.actionTypes.switchSupplier.targetType).toBe('Material');
    expect(compiled.functions.supplierRiskLevel.returns).toBe('string');
    expect(compiled.simulationKpis).toHaveLength(3);
    expect(compiled).toMatchObject(META);
  });

  it('relabels identity without recompiling', () => {
    const copy = withMeta(compiled, {...META, custom: true, etag: 3});
    expect(copy).toMatchObject({custom: true, etag: 3});
    expect(copy.objectTypes).toBe(compiled.objectTypes);
  });
});

describe('definition operations', () => {
  const link: LinkTypeDef = {
    apiName: 'alternativeTo',
    displayName: 'Alternative',
    from: 'Supplier',
    to: 'Supplier',
    cardinality: 'many',
  };

  it('creates, replaces and removes definitions without mutating', () => {
    const added = putDef(
      SUPPLY_CHAIN_DEFINITION,
      'link-types',
      link.apiName,
      link,
    );
    expect(listOf(added, 'link-types')).toHaveLength(3);
    expect(SUPPLY_CHAIN_DEFINITION.linkTypes).toHaveLength(2);

    const replaced = putDef(added, 'link-types', 'supplies', {
      ...added.linkTypes[0],
      cardinality: 'one',
    });
    expect(listOf(replaced, 'link-types').map(l => l.apiName)).toEqual([
      'supplies',
      'usedIn',
      'alternativeTo',
    ]);
    expect(findDef(replaced, 'link-types', 'supplies')?.cardinality).toBe(
      'one',
    );

    const removed = removeDef(replaced, 'link-types', 'alternativeTo');
    expect(findDef(removed, 'link-types', 'alternativeTo')).toBeUndefined();
    expect(findDef(removed, 'object-types', 'Supplier')?.primaryKey).toBe(
      'supplierId',
    );
  });

  it('recognizes kinds and normalizes stored definitions', () => {
    expect(isDefKind('action-types')).toBe(true);
    expect(isDefKind('functions')).toBe(false);
    expect(normalizeOntology({objectTypes: []})).toEqual(emptyOntology());
  });
});

describe('evaluateFunction', () => {
  const compiled = compileOntology(SUPPLY_CHAIN_DEFINITION, META);

  it('evaluates declarative functions', () => {
    expect(
      evaluateFunction(compiled, 'supplierRiskLevel', {riskScore: 82}),
    ).toBe('HIGH');
    expect(
      evaluateFunction(compiled, 'supplierRiskLevel', {riskScore: 45}),
    ).toBe('MEDIUM');
    expect(
      evaluateFunction(compiled, 'stockCoverage', {
        stock: 50,
        safetyStock: 100,
      }),
    ).toBe(0.5);
    expect(() => evaluateFunction(compiled, 'nope', {})).toThrow(/NOT_FOUND/);
  });
});
