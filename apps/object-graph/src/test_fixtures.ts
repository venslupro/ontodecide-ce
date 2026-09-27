/**
 * @fileoverview Test fixtures for object-graph: a small compiled
 * supply-chain ontology (built by hand so tests do not depend on the
 * ontology-manager compiler).
 */

import type {
  ActionTypeDef,
  CompiledObjectType,
  CompiledSchema,
  LinkTypeDef,
  ObjectTypeDef,
} from '@ontodecide/ontology/contract';

/** Compiles an object type definition (derived lookups only). */
export function compileType(def: ObjectTypeDef): CompiledObjectType {
  return {
    ...def,
    propsByName: Object.fromEntries(def.properties.map(p => [p.apiName, p])),
    indexedProps: def.properties.filter(p => p.indexed).map(p => p.apiName),
    sensitiveProps: def.properties.filter(p => p.sensitive).map(p => p.apiName),
  };
}

const SUPPLIER: ObjectTypeDef = {
  apiName: 'Supplier',
  displayName: 'Supplier',
  primaryKey: 'supplierId',
  titleProperty: 'name',
  properties: [
    {
      apiName: 'supplierId',
      displayName: 'ID',
      dataType: 'string',
      required: true,
    },
    {apiName: 'name', displayName: 'Name', dataType: 'string', required: true},
    {
      apiName: 'country',
      displayName: 'Country',
      dataType: 'string',
      indexed: true,
    },
    {
      apiName: 'riskScore',
      displayName: 'Risk',
      dataType: 'double',
      indexed: true,
    },
    {apiName: 'tier', displayName: 'Tier', dataType: 'integer', indexed: true},
    {apiName: 'active', displayName: 'Active', dataType: 'boolean'},
    {
      apiName: 'status',
      displayName: 'Status',
      dataType: 'enum',
      enumValues: ['ACTIVE', 'REVIEW', 'SUSPENDED'],
      indexed: true,
    },
    {apiName: 'notes', displayName: 'Notes', dataType: 'string'},
  ],
};

const PART: ObjectTypeDef = {
  apiName: 'Part',
  displayName: 'Part',
  primaryKey: 'partId',
  titleProperty: 'name',
  properties: [
    {apiName: 'partId', displayName: 'ID', dataType: 'string', required: true},
    {apiName: 'name', displayName: 'Name', dataType: 'string'},
    {
      apiName: 'stock',
      displayName: 'Stock',
      dataType: 'integer',
      indexed: true,
    },
    {
      apiName: 'critical',
      displayName: 'Critical',
      dataType: 'boolean',
      indexed: true,
    },
  ],
};

const LINKS: LinkTypeDef[] = [
  {
    apiName: 'supplies',
    displayName: 'supplies',
    from: 'Supplier',
    to: 'Part',
    cardinality: 'many',
    propagation: {defaultWeight: 0.5},
  },
  {
    apiName: 'dependsOn',
    displayName: 'depends on',
    from: 'Part',
    to: 'Part',
    cardinality: 'many',
    propagation: {defaultWeight: 0.8},
  },
];

const ACTIONS: ActionTypeDef[] = [
  {
    apiName: 'flagSupplier',
    displayName: 'Flag supplier',
    targetType: 'Supplier',
    parameters: [
      {
        apiName: 'reason',
        displayName: 'Reason',
        dataType: 'string',
        required: true,
      },
      {
        apiName: 'bump',
        displayName: 'Bump',
        dataType: 'double',
        defaultValue: 0.1,
      },
    ],
    preconditions: [
      {
        expr: {'==': [{var: 'target.active'}, true]},
        message: {'zh-CN': '供应商已停用', 'en-US': 'Supplier is inactive'},
      },
      {
        expr: {'<': [{var: 'target.riskScore'}, 1]},
        message: {
          'zh-CN': '风险已达上限',
          'en-US': 'Risk is already at maximum',
        },
      },
    ],
    effects: [
      {kind: 'set', prop: 'status', value: 'REVIEW'},
      {kind: 'increment', prop: 'riskScore', by: {var: 'params.bump'}},
      {kind: 'set', prop: 'notes', value: {var: 'params.reason'}},
    ],
  },
  {
    apiName: 'switchSupplier',
    displayName: 'Switch supplier',
    targetType: 'Part',
    parameters: [
      {
        apiName: 'newSupplier',
        displayName: 'New supplier',
        dataType: 'objectRef:Supplier',
        required: true,
      },
    ],
    preconditions: [],
    effects: [
      {
        kind: 'relink',
        link: 'supplies',
        direction: 'in',
        toParam: 'newSupplier',
      },
    ],
  },
  {
    apiName: 'dropSupplier',
    displayName: 'Drop supplier',
    targetType: 'Part',
    parameters: [
      {
        apiName: 'supplier',
        displayName: 'Supplier',
        dataType: 'objectRef:Supplier',
        required: true,
      },
    ],
    preconditions: [],
    effects: [
      {kind: 'unlink', link: 'supplies', direction: 'in', toParam: 'supplier'},
    ],
  },
];

/** Builds the compiled test ontology (optionally modified). */
export function testSchema(
  mutate?: (s: CompiledSchema) => void,
): CompiledSchema {
  const s: CompiledSchema = {
    templateId: 'supply-chain',
    templateVersion: '1',
    custom: false,
    etag: 0,
    objectTypes: {
      Supplier: compileType(structuredClone(SUPPLIER)),
      Part: compileType(structuredClone(PART)),
    },
    linkTypes: Object.fromEntries(
      LINKS.map(l => [l.apiName, structuredClone(l)]),
    ),
    actionTypes: Object.fromEntries(
      ACTIONS.map(a => [a.apiName, structuredClone(a)]),
    ),
    functions: {},
    simulationKpis: [],
    indexPlan: [],
  };
  mutate?.(s);
  return s;
}
