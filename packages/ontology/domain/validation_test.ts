/**
 * @fileoverview Tests of structural ontology validation and of the
 * built-in supply-chain template.
 */

import {filterProps} from '@ontodecide/shared-kernel';
import {describe, expect, it} from 'vitest';
import {MAX_INDEXED_PROPS} from '../contract';
import type {ActionTypeDef, ObjectTypeDef, OntologyDef} from '../contract';
import {
  logicVarPaths,
  objectRefTarget,
  referencesTo,
  validateOntology,
} from './validation';
import {DEFAULT_TEMPLATE, findTemplate} from './pack_registry';
import {
  SUPPLY_CHAIN_DEFINITION,
  SUPPLY_CHAIN_SEEDS,
} from './packs/supply_chain';

const clone = (): OntologyDef => structuredClone(SUPPLY_CHAIN_DEFINITION);

function objectType(def: OntologyDef, name: string): ObjectTypeDef {
  return def.objectTypes.find(t => t.apiName === name)!;
}

function action(def: OntologyDef, name: string): ActionTypeDef {
  return def.actionTypes.find(a => a.apiName === name)!;
}

const messages = (def: OntologyDef) =>
  validateOntology(def).map(i => i.message);

describe('supply-chain template', () => {
  it('is structurally valid', () => {
    expect(validateOntology(SUPPLY_CHAIN_DEFINITION)).toEqual([]);
  });

  it('keeps the property names the sample data relies on', () => {
    const names = (t: string) =>
      objectType(SUPPLY_CHAIN_DEFINITION, t).properties.map(p => p.apiName);
    expect(names('Supplier')).toEqual(
      expect.arrayContaining([
        'supplierId',
        'name',
        'country',
        'riskScore',
        'capacity',
        'onTimeRate',
        'status',
      ]),
    );
    expect(names('Material')).toEqual(
      expect.arrayContaining([
        'materialId',
        'name',
        'category',
        'safetyStock',
        'stock',
      ]),
    );
    expect(names('Product')).toEqual(
      expect.arrayContaining(['productId', 'name', 'revenue']),
    );
    const links = SUPPLY_CHAIN_DEFINITION.linkTypes;
    expect(links.map(l => [l.apiName, l.from, l.to])).toEqual([
      ['supplies', 'Supplier', 'Material'],
      ['usedIn', 'Material', 'Product'],
    ]);
    expect(links.every(l => l.propagation)).toBe(true);
  });

  it('offers a deterministic suggestion for switchSupplier.newSupplier', () => {
    const p = action(SUPPLY_CHAIN_DEFINITION, 'switchSupplier').parameters[0];
    expect(p.dataType).toBe('objectRef:Supplier');
    expect(p.suggest).toMatchObject({
      objectType: 'Supplier',
      orderBy: {prop: 'riskScore', dir: 'asc'},
      sharesLinkWithTarget: {link: 'supplies', direction: 'in'},
    });
    expect(
      SUPPLY_CHAIN_DEFINITION.actionTypes.map(a => a.apiName).sort(),
    ).toEqual(['adjustSafetyStock', 'flagSupplier', 'switchSupplier']);
  });

  it('ships seeds that reference existing types and properties', () => {
    const has = (t: string, p: string) =>
      objectType(SUPPLY_CHAIN_DEFINITION, t).properties.some(
        x => x.apiName === p,
      );
    expect(SUPPLY_CHAIN_SEEDS.kpis.map(k => k.id)).toEqual(
      expect.arrayContaining([
        'highRiskSuppliers',
        'avgRiskScore',
        'avgOnTimeRate',
      ]),
    );
    for (const k of SUPPLY_CHAIN_SEEDS.kpis) {
      if (k.aggregate.prop)
        expect(has(k.objectType, k.aggregate.prop)).toBe(true);
      for (const p of filterProps(k.filter))
        expect(has(k.objectType, p)).toBe(true);
    }
    const autos = SUPPLY_CHAIN_SEEDS.automations;
    expect(autos.find(a => a.id === 'supplierRiskHigh')).toMatchObject({
      trigger: 'threshold',
      severity: 'HIGH',
      condition: {op: 'gte', prop: 'riskScore', value: 70},
    });
    const scheduled = autos.filter(a => a.trigger === 'schedule');
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].everyHours).toBeGreaterThanOrEqual(1);
    for (const a of autos) {
      expect(a.cooldownSec).toBeLessThanOrEqual(86_400);
      for (const p of filterProps(a.condition)) {
        expect(has(a.objectType, p)).toBe(true);
      }
    }
  });

  it('is registered as the default template', () => {
    expect(DEFAULT_TEMPLATE.id).toBe('supply-chain');
    expect(findTemplate('supply-chain')).toBe(DEFAULT_TEMPLATE);
    expect(findTemplate('nope')).toBeNull();
  });
});

describe('validateOntology', () => {
  it('rejects duplicate api names', () => {
    const def = clone();
    def.objectTypes.push(structuredClone(def.objectTypes[0]));
    def.linkTypes.push(structuredClone(def.linkTypes[0]));
    const t = objectType(def, 'Material');
    t.properties.push(structuredClone(t.properties[1]));
    expect(messages(def)).toEqual(
      expect.arrayContaining([
        'Duplicate object type api name: Supplier',
        'Duplicate link type api name: supplies',
        'Duplicate property api name: name',
      ]),
    );
  });

  it('requires link ends to exist', () => {
    const def = clone();
    def.linkTypes[1].to = 'Warehouse';
    expect(validateOntology(def)).toEqual([
      {
        path: 'linkTypes.1.to',
        message: 'Object type does not exist: Warehouse',
      },
    ]);
  });

  it('requires action target types to exist', () => {
    const def = clone();
    action(def, 'flagSupplier').targetType = 'Vendor';
    expect(messages(def)).toContain('Object type does not exist: Vendor');
  });

  it(`allows at most ${MAX_INDEXED_PROPS} indexed properties per type`, () => {
    const def = clone();
    const t = objectType(def, 'Product');
    for (
      let i = 0;
      t.properties.filter(p => p.indexed).length <= MAX_INDEXED_PROPS;
      i++
    ) {
      t.properties.push({
        apiName: `extra${i}`,
        displayName: 'x',
        dataType: 'double',
        indexed: true,
      });
    }
    expect(messages(def)).toEqual([
      `At most ${MAX_INDEXED_PROPS} indexed properties per type (got ${MAX_INDEXED_PROPS + 1})`,
    ]);
  });

  it('requires the primary key and title property to exist', () => {
    const def = clone();
    const t = objectType(def, 'Supplier');
    t.primaryKey = 'code';
    t.titleProperty = 'label';
    expect(messages(def)).toEqual([
      'Primary key property does not exist: code',
      'Title property does not exist: label',
    ]);
  });

  it('rejects JSONLogic outside the safe subset', () => {
    const def = clone();
    def.functions[0].expr = {eval: ['1+1']};
    action(def, 'flagSupplier').preconditions[0].expr = {
      method: [{var: 'target.status'}, 'toString'],
    };
    expect(messages(def)).toEqual([
      'Unsupported operator: method',
      'Unsupported operator: eval',
    ]);
  });

  it('checks action variables, effects, parameters and suggestions', () => {
    const def = clone();
    const a = action(def, 'adjustSafetyStock');
    a.preconditions[0].expr = {'>': [{var: 'params.qty'}, {var: 'other.x'}]};
    a.effects.push({kind: 'increment', prop: 'category', by: 1});
    a.effects.push({
      kind: 'relink',
      link: 'usedIn',
      direction: 'in',
      toParam: 'percent',
    });
    const s = action(def, 'switchSupplier').parameters[0].suggest!;
    s.orderBy = {prop: 'nope', dir: 'asc'};
    s.sharesLinkWithTarget = {link: 'ghost', direction: 'in'};
    expect(messages(def)).toEqual(
      expect.arrayContaining([
        'Unknown parameter: qty',
        'Variables must start with target. or params.: other.x',
        'Increment needs a numeric property: category',
        'Link usedIn (in) does not attach to Material',
        'Parameter percent must be objectRef:Material',
        'Unknown property of Supplier: nope',
        'Link type does not exist: ghost',
      ]),
    );
  });

  it('checks objectRef targets, enums and simulation KPIs', () => {
    const def = clone();
    objectType(def, 'Product').properties.push(
      {apiName: 'owner', displayName: 'o', dataType: 'objectRef:Person'},
      {apiName: 'grade', displayName: 'g', dataType: 'enum'},
    );
    def.simulationKpis.push(
      {
        apiName: 'k1',
        displayName: 'k',
        objectType: 'Product',
        agg: 'sum',
        higherIsBetter: true,
      },
      {
        apiName: 'k2',
        displayName: 'k',
        objectType: 'Product',
        property: 'name',
        agg: 'avg',
        higherIsBetter: true,
      },
    );
    expect(messages(def)).toEqual([
      'Referenced object type does not exist: Person',
      'Enum properties need at least one value',
      'Aggregation sum needs a property',
      'Aggregation avg needs a numeric property',
    ]);
  });
});

describe('referencesTo', () => {
  it('finds links, actions and KPIs using an object type', () => {
    const refs = referencesTo(
      SUPPLY_CHAIN_DEFINITION,
      'object-types',
      'Supplier',
    );
    expect(refs.map(r => r.path)).toEqual(
      expect.arrayContaining([
        'linkTypes.0',
        'actionTypes.0',
        'actionTypes.2',
        'functions.0',
        'simulationKpis.1',
      ]),
    );
  });

  it('finds actions using a link type', () => {
    expect(
      referencesTo(SUPPLY_CHAIN_DEFINITION, 'link-types', 'supplies'),
    ).toEqual([
      {
        path: 'actionTypes.0',
        message: 'supplies is referenced by action type switchSupplier',
      },
    ]);
    expect(
      referencesTo(SUPPLY_CHAIN_DEFINITION, 'link-types', 'usedIn'),
    ).toEqual([]);
    expect(
      referencesTo(SUPPLY_CHAIN_DEFINITION, 'action-types', 'flagSupplier'),
    ).toEqual([]);
  });
});

describe('helpers', () => {
  it('parses objectRef data types and var paths', () => {
    expect(objectRefTarget('objectRef:Supplier')).toBe('Supplier');
    expect(objectRefTarget('string')).toBeNull();
    expect(
      logicVarPaths({'+': [{var: 'a.b'}, {var: ['c', {var: 'd'}]}]}).sort(),
    ).toEqual(['a.b', 'c', 'd']);
  });
});
