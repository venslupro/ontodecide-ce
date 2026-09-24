/**
 * @fileoverview Tests for structural and cross-schema validation.
 */

import {describe, expect, it} from 'vitest';
import type {SchemaDef} from '../contract';
import {SUPPLY_CHAIN_PACK} from './packs/supply_chain';
import {
  checkCrossSchemaConflicts,
  schemaNames,
  validateSchema,
} from './validation';

const base = (): SchemaDef => structuredClone(SUPPLY_CHAIN_PACK.schema);

function messages(def: SchemaDef): string[] {
  return validateSchema(def).map(i => `${i.path}: ${i.message}`);
}

describe('validateSchema', () => {
  it('accepts the built-in supply chain pack', () => {
    expect(validateSchema(base())).toEqual([]);
  });

  it('reports duplicate api names per kind', () => {
    const def = base();
    def.objectTypes.push(structuredClone(def.objectTypes[0]));
    def.linkTypes.push(structuredClone(def.linkTypes[0]));
    def.actionTypes.push(structuredClone(def.actionTypes[0]));
    def.functions.push(structuredClone(def.functions[0]));
    def.objectTypes[1].properties.push(
      structuredClone(def.objectTypes[1].properties[0]),
    );
    const m = messages(def);
    expect(m).toContain(
      'objectTypes.3.apiName: Duplicate object type api name: Supplier',
    );
    expect(m).toContain(
      'linkTypes.2.apiName: Duplicate link type api name: supplies',
    );
    expect(m).toContain(
      'actionTypes.3.apiName: Duplicate action type api name: switchSupplier',
    );
    expect(m).toContain(
      'functions.2.apiName: Duplicate function api name: supplierRiskLevel',
    );
    expect(m).toContain(
      'objectTypes.1.properties.4.apiName: Duplicate property api name: materialId',
    );
  });

  it('reports missing primary key and title property', () => {
    const def = base();
    def.objectTypes[0].primaryKey = 'nope';
    def.objectTypes[0].titleProperty = 'nada';
    const m = messages(def);
    expect(m).toContain(
      'objectTypes.0.primaryKey: Primary key property does not exist: nope',
    );
    expect(m).toContain(
      'objectTypes.0.titleProperty: Title property does not exist: nada',
    );
  });

  it('reports link ends that do not exist', () => {
    const def = base();
    def.linkTypes[0].from = 'Ghost';
    def.linkTypes[1].to = 'Phantom';
    const m = messages(def);
    expect(m).toContain('linkTypes.0.from: Object type does not exist: Ghost');
    expect(m).toContain('linkTypes.1.to: Object type does not exist: Phantom');
  });

  it('reports a missing action target type', () => {
    const def = base();
    def.actionTypes[2].targetType = 'Ghost';
    expect(messages(def)).toContain(
      'actionTypes.2.targetType: Object type does not exist: Ghost',
    );
  });

  it('reports effects on unknown props, links and params', () => {
    const def = base();
    def.actionTypes[1].effects[0] = {kind: 'increment', prop: 'nope', by: 1};
    def.actionTypes[1].effects[1] = {kind: 'increment', prop: 'name', by: 1};
    def.actionTypes[0].effects = [
      {
        kind: 'relink',
        link: 'ghostLink',
        direction: 'in',
        toParam: 'newSupplier',
      },
      {kind: 'relink', link: 'supplies', direction: 'out', toParam: 'missing'},
    ];
    const m = messages(def);
    expect(m).toContain(
      'actionTypes.1.effects.0.prop: Unknown property of Product: nope',
    );
    expect(m).toContain(
      'actionTypes.1.effects.1.prop: Increment needs a numeric property: name',
    );
    expect(m).toContain(
      'actionTypes.0.effects.0.link: Link type does not exist: ghostLink',
    );
    expect(m).toContain(
      'actionTypes.0.effects.1.direction: Link supplies (out) does not attach to Material',
    );
    expect(m).toContain(
      'actionTypes.0.effects.1.toParam: Unknown parameter: missing',
    );
  });

  it('reports JSONLogic variables that do not resolve', () => {
    const def = base();
    def.actionTypes[1].preconditions[0].expr = {
      '>': [{var: 'params.weeks'}, 0],
    };
    def.actionTypes[2].preconditions[0].expr = {
      '!==': [{var: 'target.ghost'}, 'x'],
    };
    def.functions[0].expr = {'>': [{var: 'ghostScore'}, 1]};
    const m = messages(def);
    expect(m).toContain(
      'actionTypes.1.preconditions.0.expr: Unknown parameter: weeks',
    );
    expect(m).toContain(
      'actionTypes.2.preconditions.0.expr: Unknown property of Supplier: ghost',
    );
    expect(m).toContain(
      'functions.0.expr: Unknown property of Supplier: ghostScore',
    );
  });

  it('reports suggest.objectType, orderBy and filter props that do not exist', () => {
    const def = base();
    const suggest = def.actionTypes[0].parameters[0].suggest!;
    suggest.orderBy = {prop: 'ghost', dir: 'asc'};
    suggest.filter = {op: 'eq', prop: 'phantom', value: 1};
    expect(messages(def)).toEqual(
      expect.arrayContaining([
        'actionTypes.0.parameters.0.suggest.orderBy.prop: Unknown property of Supplier: ghost',
        'actionTypes.0.parameters.0.suggest.filter: Unknown property of Supplier: phantom',
      ]),
    );
    suggest.objectType = 'Ghost';
    expect(messages(def)).toContain(
      'actionTypes.0.parameters.0.suggest.objectType: Object type does not exist: Ghost',
    );
  });

  it('reports objectRef targets that do not exist', () => {
    const def = base();
    def.objectTypes[2].properties.push({
      apiName: 'owner',
      displayName: 'Owner',
      dataType: 'objectRef:Ghost',
    });
    def.actionTypes[0].parameters[0].dataType = 'objectRef:Phantom';
    const m = messages(def);
    expect(m).toContain(
      'objectTypes.2.properties.6.dataType: Referenced object type does not exist: Ghost',
    );
    expect(m).toContain(
      'actionTypes.0.parameters.0.dataType: Referenced object type does not exist: Phantom',
    );
  });

  it('reports unsupported JSONLogic operators', () => {
    const def = base();
    def.functions[1].expr = {eval: ['1+1']};
    def.actionTypes[2].effects[0] = {
      kind: 'set',
      prop: 'status',
      value: {map: [1]},
    };
    const m = messages(def);
    expect(m).toContain('functions.1.expr: Unsupported operator: eval');
    expect(m).toContain(
      'actionTypes.2.effects.0.value: Unsupported operator: map',
    );
  });

  it('reports simulation KPIs over unknown types or props', () => {
    const def = base();
    def.simulationKpis![0].property = 'ghost';
    def.simulationKpis![1].objectType = 'Ghost';
    def.simulationKpis!.push({
      apiName: 'names',
      displayName: 'Names',
      objectType: 'Product',
      property: 'name',
      agg: 'sum',
      higherIsBetter: true,
    });
    const m = messages(def);
    expect(m).toContain(
      'simulationKpis.0.property: Unknown property of Product: ghost',
    );
    expect(m).toContain(
      'simulationKpis.1.objectType: Object type does not exist: Ghost',
    );
    expect(m).toContain(
      'simulationKpis.2.property: Aggregation sum needs a numeric property',
    );
  });

  it('reports impact hints on properties unknown to the schema', () => {
    const def = base();
    def.actionTypes[1].impact = [{property: 'ghost', change: 0.1}];
    expect(messages(def)).toContain(
      'actionTypes.1.impact.0.property: Unknown property: ghost',
    );
  });

  it('reports enum properties without values', () => {
    const def = base();
    delete def.objectTypes[0].properties[6].enumValues;
    expect(messages(def)).toContain(
      'objectTypes.0.properties.6.enumValues: Enum properties need at least one value',
    );
  });
});

describe('checkCrossSchemaConflicts', () => {
  it('reports api names defined by another schema of the tenant', () => {
    const other = base();
    other.apiName = 'other';
    const issues = checkCrossSchemaConflicts(base(), [schemaNames(other)]);
    expect(issues).toContainEqual({
      path: 'objectTypes.0.apiName',
      message: 'Object type Supplier is already defined by schema other',
    });
    expect(issues.some(i => i.path.startsWith('linkTypes'))).toBe(true);
    expect(issues.some(i => i.path.startsWith('actionTypes'))).toBe(true);
  });

  it('ignores the schema being replaced', () => {
    expect(checkCrossSchemaConflicts(base(), [schemaNames(base())])).toEqual(
      [],
    );
  });
});
