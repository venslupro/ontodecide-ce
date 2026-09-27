/**
 * @fileoverview Workbench form model: form ↔ definition round trips,
 * validation rules and server field errors.
 */

import type {
  ActionTypeDef,
  LinkTypeDef,
  ObjectTypeDef,
} from '@ontodecide/ontology/contract';
import {describe, expect, it} from 'vitest';
import {ApiError} from '../../shared/api/errors';
import {ontologyDef} from '../../test/fixtures/business';
import {
  actionTypeToForm,
  buildDef,
  formToDef,
  fromPair,
  linkTypeToForm,
  MAX_INDEXED_PROPS,
  newForm,
  newPropertyForm,
  objectTypeToForm,
  type ObjectTypeForm,
  referencesTo,
  schemaGraph,
  serverIssues,
  toPair,
  withDefinition,
} from './model';

const ctx = {def: ontologyDef, isNew: false};
const supplier = ontologyDef.objectTypes[0];

describe('i18n pairs', () => {
  it('converts both ways and omits an empty English text', () => {
    expect(toPair('名称')).toEqual({zh: '名称', en: ''});
    expect(toPair({'zh-CN': '甲', 'en-US': 'A'})).toEqual({zh: '甲', en: 'A'});
    expect(fromPair({zh: ' 甲 ', en: ''})).toEqual({'zh-CN': '甲'});
    expect(fromPair({zh: '甲', en: 'A'})).toEqual({
      'zh-CN': '甲',
      'en-US': 'A',
    });
  });
});

describe('round trips', () => {
  it('object type', () => {
    const {def, issues} = formToDef(objectTypeToForm(supplier));
    expect(issues).toEqual([]);
    expect(def).toEqual(supplier);
  });

  it('link type', () => {
    for (const l of ontologyDef.linkTypes) {
      expect(formToDef(linkTypeToForm(l)).def).toEqual(l);
    }
  });

  it('action type (JSONLogic as text, preserved defaults)', () => {
    for (const a of ontologyDef.actionTypes) {
      expect(formToDef(actionTypeToForm(a)).def).toEqual(a);
    }
  });

  it('valid definitions pass buildDef', () => {
    expect(buildDef(objectTypeToForm(supplier), ctx).issues).toEqual([]);
    expect(
      buildDef(linkTypeToForm(ontologyDef.linkTypes[0]), ctx).issues,
    ).toEqual([]);
    expect(
      buildDef(actionTypeToForm(ontologyDef.actionTypes[0]), ctx).issues,
    ).toEqual([]);
  });
});

describe('object type validation', () => {
  it('rejects bad api names, duplicates and missing display names', () => {
    const f = objectTypeToForm(supplier);
    f.properties[1].apiName = 'supplierId';
    f.properties[2].apiName = '9bad';
    f.properties[3].displayName = {zh: '', en: 'x'};
    const paths = buildDef(f, ctx).issues.map(i => `${i.path}:${i.code}`);
    expect(paths).toContain('properties.1.apiName:duplicate');
    expect(paths).toContain('properties.2.apiName:apiName');
    expect(paths).toContain('properties.3.displayName:required');
  });

  it(`limits indexed properties to ${MAX_INDEXED_PROPS}`, () => {
    const f = objectTypeToForm(supplier);
    for (let i = 0; i < MAX_INDEXED_PROPS; i++) {
      const p = newPropertyForm(`extra${i}`);
      p.displayName = {zh: `额外${i}`, en: ''};
      p.indexed = true;
      f.properties.push(p);
    }
    const r = buildDef(f, ctx);
    expect(r.def).toBeUndefined();
    expect(r.issues).toContainEqual(
      expect.objectContaining({path: 'properties', code: 'maxIndexed'}),
    );
  });

  it('requires enum values, known objectRef targets and key properties', () => {
    const f = objectTypeToForm(supplier);
    f.properties[2].dataType = 'enum';
    f.properties[3].dataType = 'objectRef:Nope';
    f.primaryKey = 'missing';
    const codes = buildDef(f, ctx).issues.map(i => `${i.path}:${i.code}`);
    expect(codes).toContain('properties.2.enumValues:enumValues');
    expect(codes).toContain('properties.3.dataType:unknownType');
    expect(codes).toContain('primaryKey:unknownProp');
  });

  it('a new type needs a free api name and ≥ 1 property', () => {
    const f = newForm('object-types', ['Supplier']) as ObjectTypeForm;
    f.apiName = 'Supplier';
    f.displayName = {zh: '重复', en: ''};
    expect(
      buildDef(f, {def: ontologyDef, isNew: true}).issues.map(i => i.code),
    ).toContain('idTaken');
    f.apiName = 'Warehouse';
    const ok = buildDef(f, {def: ontologyDef, isNew: true});
    expect(ok.issues).toEqual([]);
    expect(ok.def).toMatchObject({
      apiName: 'Warehouse',
      primaryKey: 'id',
      properties: [{apiName: 'id', required: true, indexed: true}],
    });
    f.properties = [];
    f.primaryKey = '';
    expect(
      buildDef(f, {def: ontologyDef, isNew: true}).issues.map(i => i.code),
    ).toContain('propertiesMin');
  });

  it('omits empty optional fields', () => {
    const f = objectTypeToForm(supplier);
    f.properties[6].dataType = 'string';
    f.properties[6].unit = '  ';
    const def = formToDef(f).def as ObjectTypeDef;
    expect(def.properties[6]).not.toHaveProperty('enumValues');
    expect(def.properties[6]).not.toHaveProperty('unit');
  });
});

describe('link and action validation', () => {
  it('link weight is within 0..1 and endpoints must exist', () => {
    const f = linkTypeToForm(ontologyDef.linkTypes[0]);
    f.defaultWeight = '1.5';
    f.to = 'Ghost';
    const codes = buildDef(f, ctx).issues.map(i => `${i.path}:${i.code}`);
    expect(codes).toContain('propagation.defaultWeight:range');
    expect(codes).toContain('to:unknownType');
    f.propagates = false;
    f.to = 'Material';
    expect((buildDef(f, ctx).def as LinkTypeDef).propagation).toBeUndefined();
  });

  it('action JSON, effect props, links and params are checked', () => {
    const f = actionTypeToForm(ontologyDef.actionTypes[0]);
    f.preconditions[0].exprText = '{bad json';
    f.effects[0].prop = 'ghost';
    f.effects.push({
      key: 'x',
      kind: 'relink',
      prop: '',
      valueText: '',
      link: 'nope',
      direction: 'out',
      toParam: 'missing',
    });
    f.impact[0].change = '2';
    const codes = buildDef(f, ctx).issues.map(i => `${i.path}:${i.code}`);
    expect(codes).toContain('preconditions.0.expr:json');
    expect(codes).toContain('effects.0.prop:unknownProp');
    expect(codes).toContain('effects.1.link:unknownLink');
    expect(codes).toContain('effects.1.toParam:unknownParam');
    expect(codes).toContain('impact.0.change:range');
  });

  it('builds an unlink without a parameter', () => {
    const f = actionTypeToForm(ontologyDef.actionTypes[2]);
    f.effects = [
      {
        key: 'u',
        kind: 'unlink',
        prop: '',
        valueText: '',
        link: 'supplies',
        direction: 'out',
        toParam: '',
      },
    ];
    const r = buildDef(f, ctx);
    expect(r.issues).toEqual([]);
    expect((r.def as ActionTypeDef).effects).toEqual([
      {kind: 'unlink', link: 'supplies', direction: 'out'},
    ]);
  });
});

describe('server issues, references and graph', () => {
  it('maps VALIDATION_FAILED extras.errors', () => {
    const err = new ApiError({
      code: 'VALIDATION_FAILED',
      status: 422,
      extras: {errors: [{path: 'properties.0.apiName', message: 'bad'}]},
    });
    expect(serverIssues(err)).toEqual([
      {path: 'properties.0.apiName', code: 'server', message: 'bad'},
    ]);
    expect(serverIssues(new ApiError({code: 'CONFLICT', status: 409}))).toEqual(
      [],
    );
  });

  it('lists references to a type', () => {
    expect(referencesTo(ontologyDef, 'Supplier')).toEqual({
      links: ['supplies'],
      actions: ['suspendSupplier', 'reactivateSupplier'],
      properties: ['PurchaseOrder.supplier'],
    });
  });

  it('builds the schema graph', () => {
    const g = schemaGraph(ontologyDef, 'en-US');
    expect(g.nodes.map(n => n.id)).toEqual([
      'Supplier',
      'Material',
      'Plant',
      'PurchaseOrder',
    ]);
    expect(g.edges[0]).toMatchObject({
      source: 'Supplier',
      target: 'Material',
      label: 'Supplies',
      weight: 0.8,
    });
  });
});

describe('withDefinition', () => {
  it('replaces, adds and removes a definition and marks the copy custom', () => {
    const o = {
      templateId: 'supply-chain',
      templateVersion: '1',
      custom: false,
      etag: 0,
      definition: ontologyDef,
      updatedAt: null,
    };
    const lt = {...ontologyDef.linkTypes[0], cardinality: 'one' as const};
    const a = withDefinition(o, 'link-types', 'supplies', lt, 1);
    expect(a).toMatchObject({etag: 1, custom: true});
    expect(a.definition.linkTypes[0].cardinality).toBe('one');
    const b = withDefinition(a, 'link-types', 'x', {...lt, apiName: 'x'}, 2);
    expect(b.definition.linkTypes).toHaveLength(4);
    const c = withDefinition(b, 'object-types', 'Plant', null, 3);
    expect(c.definition.objectTypes.map(t => t.apiName)).not.toContain('Plant');
  });
});
