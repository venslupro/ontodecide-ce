/**
 * @fileoverview Test fixture: a small supply-chain ontology (compiled form)
 * and graph. S1 (risk 80) and S2 (risk 20) supply M1, S3 (suspended)
 * supplies M1, S4 supplies M2; M1 is used in P1 and P2, M2 in P2.
 */

import type {Rid} from '@ontodecide/shared-kernel';
import type {
  GraphEdge,
  GraphNode,
  GraphSlice,
} from '@ontodecide/object-graph/contract';
import type {
  ActionTypeDef,
  CompiledObjectType,
  CompiledSchema,
  LinkTypeDef,
  PropertyDef,
} from '@ontodecide/ontology/contract';

/** RID of test object `n` of `type`. */
export function rid(type: string, n: number): Rid {
  return `ri.${type}.01K6A${String(n).padStart(21, '0')}` as Rid;
}

export const S1 = rid('Supplier', 1);
export const S2 = rid('Supplier', 2);
export const S3 = rid('Supplier', 3);
export const S4 = rid('Supplier', 4);
export const M1 = rid('Material', 1);
export const M2 = rid('Material', 2);
export const P1 = rid('Product', 1);
export const P2 = rid('Product', 2);

function prop(
  apiName: string,
  dataType: PropertyDef['dataType'],
  extra: Partial<PropertyDef> = {},
): PropertyDef {
  return {apiName, displayName: apiName, dataType, ...extra};
}

function objectType(
  apiName: string,
  primaryKey: string,
  properties: PropertyDef[],
): CompiledObjectType {
  return {
    apiName,
    displayName: apiName,
    primaryKey,
    titleProperty: 'name',
    properties,
    propsByName: Object.fromEntries(properties.map(p => [p.apiName, p])),
    indexedProps: [],
    sensitiveProps: properties.filter(p => p.sensitive).map(p => p.apiName),
  };
}

const linkTypes: LinkTypeDef[] = [
  {
    apiName: 'supplies',
    displayName: 'supplies',
    from: 'Supplier',
    to: 'Material',
    cardinality: 'many',
    propagation: {defaultWeight: 1},
  },
  {
    apiName: 'usedIn',
    displayName: 'usedIn',
    from: 'Material',
    to: 'Product',
    cardinality: 'many',
    propagation: {defaultWeight: 1},
  },
  {
    apiName: 'locatedNear',
    displayName: 'locatedNear',
    from: 'Supplier',
    to: 'Supplier',
    cardinality: 'many',
  },
];

const actionTypes: ActionTypeDef[] = [
  {
    apiName: 'switchSupplier',
    displayName: {'zh-CN': '切换供应商', 'en-US': 'Switch supplier'},
    targetType: 'Material',
    parameters: [
      {
        apiName: 'newSupplier',
        displayName: 'newSupplier',
        dataType: 'objectRef:Supplier',
        required: true,
        suggest: {
          objectType: 'Supplier',
          filter: {op: 'eq', prop: 'status', value: 'active'},
          orderBy: {prop: 'riskScore', dir: 'asc'},
          sharesLinkWithTarget: {link: 'supplies', direction: 'in'},
        },
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
    impact: [{property: 'capacity', change: 0.5}],
  },
  {
    apiName: 'increaseSafetyStock',
    displayName: {'zh-CN': '提高安全库存', 'en-US': 'Increase safety stock'},
    targetType: 'Product',
    parameters: [
      {
        apiName: 'days',
        displayName: 'days',
        dataType: 'integer',
        required: true,
        defaultValue: 7,
      },
    ],
    preconditions: [
      {
        expr: {
          and: [
            {'>': [{var: 'params.days'}, 0]},
            {'<=': [{var: 'params.days'}, 30]},
          ],
        },
        message: 'days 1-30',
      },
    ],
    effects: [
      {kind: 'increment', prop: 'inventoryDays', by: {var: 'params.days'}},
    ],
  },
  {
    apiName: 'flagSupplier',
    displayName: {'zh-CN': '标记观察', 'en-US': 'Flag supplier'},
    targetType: 'Supplier',
    parameters: [
      {apiName: 'reason', displayName: 'reason', dataType: 'string'},
    ],
    preconditions: [
      {expr: {'!==': [{var: 'target.status'}, 'suspended']}, message: 'no'},
    ],
    effects: [{kind: 'set', prop: 'status', value: 'watch'}],
  },
];

/** Compiled test schema. */
export function testSchema(): CompiledSchema {
  return {
    templateId: 'supply-chain',
    templateVersion: 'test',
    custom: false,
    etag: 0,
    objectTypes: {
      Supplier: objectType('Supplier', 'supplierId', [
        prop('supplierId', 'string'),
        prop('name', 'string'),
        prop('riskScore', 'integer', {semanticTags: ['risk']}),
        prop('capacity', 'double'),
        prop('status', 'enum', {enumValues: ['active', 'watch', 'suspended']}),
        prop('contactEmail', 'string', {sensitive: true}),
      ]),
      Material: objectType('Material', 'materialId', [
        prop('materialId', 'string'),
        prop('name', 'string'),
        prop('capacity', 'double'),
      ]),
      Product: objectType('Product', 'productId', [
        prop('productId', 'string'),
        prop('name', 'string'),
        prop('dailyDemand', 'double'),
        prop('inventoryDays', 'double'),
      ]),
    },
    linkTypes: Object.fromEntries(linkTypes.map(l => [l.apiName, l])),
    actionTypes: Object.fromEntries(actionTypes.map(a => [a.apiName, a])),
    functions: {},
    simulationKpis: [
      {
        apiName: 'fulfillableDemand',
        displayName: {'zh-CN': '可满足日需求', 'en-US': 'Fulfillable demand'},
        objectType: 'Product',
        property: 'dailyDemand',
        agg: 'sum',
        higherIsBetter: true,
      },
      {
        apiName: 'healthyProducts',
        displayName: 'healthyProducts',
        objectType: 'Product',
        agg: 'count',
        higherIsBetter: true,
      },
    ],
    indexPlan: [],
  };
}

/** A test object. */
export interface TestObject {
  rid: Rid;
  type: string;
  title: string;
  props: Record<string, unknown>;
}

/** Objects of the fixture graph. */
export function testObjects(): TestObject[] {
  return [
    {
      rid: S1,
      type: 'Supplier',
      title: 'Alpha',
      props: {
        supplierId: 'S1',
        name: 'Alpha',
        riskScore: 80,
        capacity: 100,
        status: 'active',
        contactEmail: 'alpha@example.com',
      },
    },
    {
      rid: S2,
      type: 'Supplier',
      title: 'Beta',
      props: {
        supplierId: 'S2',
        name: 'Beta',
        riskScore: 20,
        capacity: 80,
        status: 'active',
        contactEmail: 'beta@example.com',
      },
    },
    {
      rid: S3,
      type: 'Supplier',
      title: 'Gamma',
      props: {
        supplierId: 'S3',
        name: 'Gamma',
        riskScore: 5,
        capacity: 50,
        status: 'suspended',
      },
    },
    {
      rid: S4,
      type: 'Supplier',
      title: 'Delta',
      props: {supplierId: 'S4', name: 'Delta', riskScore: 30, status: 'active'},
    },
    {
      rid: M1,
      type: 'Material',
      title: 'Steel',
      props: {materialId: 'M1', name: 'Steel', capacity: 200},
    },
    {
      rid: M2,
      type: 'Material',
      title: 'Glass',
      props: {materialId: 'M2', name: 'Glass', capacity: 50},
    },
    {
      rid: P1,
      type: 'Product',
      title: 'Car',
      props: {
        productId: 'P1',
        name: 'Car',
        dailyDemand: 100,
        inventoryDays: 10,
      },
    },
    {
      rid: P2,
      type: 'Product',
      title: 'Bike',
      props: {productId: 'P2', name: 'Bike', dailyDemand: 50, inventoryDays: 5},
    },
  ];
}

/** Edges of the fixture graph. */
export function testEdges(): GraphEdge[] {
  return [
    {type: 'supplies', src: S1, dst: M1, weight: 0.6},
    {type: 'supplies', src: S2, dst: M1, weight: 0.4},
    {type: 'supplies', src: S3, dst: M1, weight: 0.1},
    {type: 'supplies', src: S4, dst: M2, weight: null},
    {type: 'usedIn', src: M1, dst: P1, weight: 1},
    {type: 'usedIn', src: M1, dst: P2, weight: 0.5},
    {type: 'usedIn', src: M2, dst: P2, weight: 0.5},
    {type: 'locatedNear', src: S1, dst: S4, weight: 1},
  ];
}

/** The whole fixture graph as a slice (hop 0 for every node). */
export function testSlice(): GraphSlice {
  const nodes: GraphNode[] = testObjects().map(o => ({...o, hop: 0}));
  return {nodes, edges: testEdges(), truncated: false};
}
