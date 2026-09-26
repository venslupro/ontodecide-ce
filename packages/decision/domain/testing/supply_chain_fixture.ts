/**
 * @fileoverview Test fixture: the supply-chain pack compiled into a
 * CompiledModel and the sample graph from samples/supply-chain/*.csv.
 * Test-only; not exported from the domain index.
 */

import type {Rid} from '@ontodecide/shared-kernel';
import type {
  GraphEdge,
  GraphNode,
  GraphSlice,
} from '@ontodecide/object-graph/contract';
import type {
  CompiledModel,
  CompiledObjectType,
  SchemaDef,
} from '@ontodecide/ontology/contract';
import {SUPPLY_CHAIN_PACK} from '../../../ontology/domain/packs/supply_chain';

/** Minimal compiler equivalent to ontology-manager's for tests. */
export function compileModel(
  schema: SchemaDef,
  tenantId = 't1',
): CompiledModel {
  const objectTypes: Record<string, CompiledObjectType> = {};
  for (const ot of schema.objectTypes) {
    objectTypes[ot.apiName] = {
      ...ot,
      schemaApi: schema.apiName,
      propsByName: Object.fromEntries(ot.properties.map(p => [p.apiName, p])),
      indexedProps: ot.properties.filter(p => p.indexed).map(p => p.apiName),
      sensitiveProps: ot.properties
        .filter(p => p.sensitive)
        .map(p => p.apiName),
    };
  }
  return {
    tenantId,
    version: schema.version ?? '1.0.0',
    hash: 'test',
    schemas: [{apiName: schema.apiName, version: schema.version ?? '1.0.0'}],
    objectTypes,
    linkTypes: Object.fromEntries(schema.linkTypes.map(l => [l.apiName, l])),
    actionTypes: Object.fromEntries(
      schema.actionTypes.map(a => [a.apiName, a]),
    ),
    functions: Object.fromEntries(schema.functions.map(f => [f.apiName, f])),
    simulationKpis: schema.simulationKpis ?? [],
    indexPlan: [],
  };
}

/** The compiled supply-chain model. */
export function supplyChainModel(tenantId = 't1'): CompiledModel {
  return compileModel(structuredClone(SUPPLY_CHAIN_PACK.schema), tenantId);
}

/** RID helper: `ri.<tenant>.<Type>.<pk>`. */
export function rid(type: string, pk: string, tenantId = 't1'): Rid {
  return `ri.${tenantId}.${type}.${pk}`;
}

const SUPPLIERS: [
  string,
  string,
  string,
  number,
  number,
  number,
  string,
  string,
  string[],
  number,
][] = [
  [
    'S-001',
    'Shenzhen Precision Parts',
    'CN',
    35,
    1200,
    0.96,
    'active',
    'ops@szpp.example',
    ['M-100', 'M-101'],
    0.7,
  ],
  [
    'S-002',
    'Hanoi Circuit Works',
    'VN',
    58,
    800,
    0.91,
    'active',
    'sales@hcw.example',
    ['M-101', 'M-102'],
    0.3,
  ],
  [
    'S-003',
    'Penang Semicon',
    'MY',
    22,
    1500,
    0.98,
    'active',
    'contact@penang.example',
    ['M-102'],
    0.7,
  ],
  [
    'S-004',
    'Osaka Battery Co',
    'JP',
    41,
    600,
    0.94,
    'active',
    'info@osakabat.example',
    ['M-103'],
    1,
  ],
  [
    'S-005',
    'Bangkok Metal Forming',
    'TH',
    18,
    900,
    0.97,
    'active',
    'hello@bmf.example',
    ['M-100'],
    0.3,
  ],
];

const MATERIALS: [string, string, string, number, string[]][] = [
  ['M-100', 'Aluminium housing', 'Mechanical', 42.5, ['P-900', 'P-901']],
  ['M-101', 'Controller PCB', 'Electronics', 88, ['P-900']],
  ['M-102', 'Power IC', 'Electronics', 12.3, ['P-900', 'P-902']],
  ['M-103', 'Li-ion cell', 'Energy', 31, ['P-901', 'P-902']],
];

const PRODUCTS: [string, string, number, number, number, number][] = [
  ['P-900', 'Edge Gateway X1', 320, 12, 5, 1299],
  ['P-901', 'Handheld Scanner S2', 180, 6, 4, 899],
  ['P-902', 'Smart Sensor Hub', 450, 9, 5, 459],
];

/** The full sample graph (5 suppliers, 4 materials, 3 products). */
export function supplyChainGraph(tenantId = 't1'): GraphSlice {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (const [
    id,
    name,
    country,
    riskScore,
    capacity,
    onTimeRate,
    status,
    contactEmail,
    mats,
    share,
  ] of SUPPLIERS) {
    nodes.push({
      rid: rid('Supplier', id, tenantId),
      type: 'Supplier',
      title: name,
      props: {
        supplierId: id,
        name,
        country,
        riskScore,
        capacity,
        onTimeRate,
        status,
        contactEmail,
      },
    });
    for (const m of mats) {
      edges.push({
        type: 'supplies',
        src: rid('Supplier', id, tenantId),
        dst: rid('Material', m, tenantId),
        weight: share,
      });
    }
  }
  for (const [id, name, category, unitCost, prods] of MATERIALS) {
    nodes.push({
      rid: rid('Material', id, tenantId),
      type: 'Material',
      title: name,
      props: {materialId: id, name, category, unitCost},
    });
    for (const p of prods) {
      edges.push({
        type: 'usedIn',
        src: rid('Material', id, tenantId),
        dst: rid('Product', p, tenantId),
        weight: null,
      });
    }
  }
  for (const [
    id,
    name,
    dailyDemand,
    inventoryDays,
    safetyStockDays,
    revenuePerUnit,
  ] of PRODUCTS) {
    nodes.push({
      rid: rid('Product', id, tenantId),
      type: 'Product',
      title: name,
      props: {
        productId: id,
        name,
        dailyDemand,
        inventoryDays,
        safetyStockDays,
        revenuePerUnit,
      },
    });
  }
  return {nodes, edges};
}

/** Outgoing BFS subgraph (what object-graph's impactSubgraph returns). */
export function subgraph(
  graph: GraphSlice,
  roots: readonly Rid[],
  linkTypes: readonly string[] = [],
  maxHops = 3,
  limit = 500,
): GraphSlice {
  const byRid = new Map(graph.nodes.map(n => [n.rid, n]));
  const hop = new Map<Rid, number>();
  const queue: Rid[] = [];
  for (const r of roots) {
    if (byRid.has(r) && !hop.has(r)) {
      hop.set(r, 0);
      queue.push(r);
    }
  }
  const edges: GraphEdge[] = [];
  for (let h = 0; h < queue.length; h++) {
    const cur = queue[h];
    const d = hop.get(cur)!;
    if (d >= maxHops) continue;
    for (const e of graph.edges) {
      if (e.src !== cur) continue;
      if (linkTypes.length && !linkTypes.includes(e.type)) continue;
      if (!hop.has(e.dst)) {
        if (hop.size >= limit) continue;
        hop.set(e.dst, d + 1);
        queue.push(e.dst);
      }
      edges.push(e);
    }
  }
  return {
    nodes: queue.map(r => ({
      ...structuredClone(byRid.get(r)!),
      hop: hop.get(r),
    })),
    edges: edges.filter(e => hop.has(e.src) && hop.has(e.dst)),
  };
}
