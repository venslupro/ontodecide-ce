/**
 * @fileoverview Test fixtures typed by the backend contracts, modelled on
 * the built-in supply-chain pack and `samples/supply-chain/*.csv`.
 */

import type {
  RecommendationDto,
  ScenarioDto,
  ScenarioResult,
} from '@ontodecide/decision/contract';
import type {UserDto} from '@ontodecide/identity/contract';
import type {
  DataHealthDto,
  JobDto,
  RawRecordDto,
  SourceDto,
} from '@ontodecide/integration/contract';
import type {
  ActionLogDto,
  LineageDto,
  ObjectDto,
} from '@ontodecide/object-graph/contract';
import type {
  ActionTypeDef,
  CompiledModel,
  CompiledObjectType,
  LinkTypeDef,
  ObjectTypeDef,
  PackSummary,
  SchemaDef,
  SchemaSummary,
} from '@ontodecide/ontology/contract';
import type {Rid, UsageStatus} from '@ontodecide/shared-kernel';
import type {
  AlertDto,
  AutomationDto,
  CockpitLayout,
  DeadLetterDto,
  KpiValue,
  RecommendationSummary,
} from '@ontodecide/situation/contract';
import type {Overview} from '../features/situation/model';

/** Fixed "now" used by fixtures. */
export const NOW = '2026-09-24T08:00:00.000Z';
const T = 't1';

/** Builds a RID. */
export function rid(type: string, id: string): Rid {
  return `ri.${T}.${type}.${id}`;
}

// ----------------------------------------------------------------------------
// Users
// ----------------------------------------------------------------------------

function user(
  id: string,
  role: UserDto['role'],
  name: string,
  markings: string[] = [],
): UserDto {
  return {
    id,
    tenantId: T,
    email: `${id}@example.com`,
    name,
    role,
    markings,
    disabled: false,
    locale: 'zh-CN',
    mustChangePassword: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    lastLoginAt: NOW,
  };
}

export const adminUser = user('admin', 'Admin', 'Ada Admin', [
  'PII',
  'FINANCE',
]);
export const modelerUser = user('modeler', 'Modeler', 'Mo Modeler', [
  'FINANCE',
]);
export const operatorUser = user('operator', 'Operator', 'Otto Operator');
export const viewerUser = user('viewer', 'Viewer', 'Vera Viewer');
export const users: UserDto[] = [
  adminUser,
  modelerUser,
  operatorUser,
  viewerUser,
];

// ----------------------------------------------------------------------------
// Ontology (supply chain)
// ----------------------------------------------------------------------------

export const supplierType: ObjectTypeDef = {
  apiName: 'Supplier',
  displayName: {'zh-CN': '供应商', 'en-US': 'Supplier'},
  icon: 'factory',
  primaryKey: 'supplierId',
  titleProperty: 'name',
  graphProjected: true,
  properties: [
    {
      apiName: 'supplierId',
      displayName: {'zh-CN': '供应商编号', 'en-US': 'Supplier ID'},
      dataType: 'string',
      required: true,
    },
    {
      apiName: 'name',
      displayName: {'zh-CN': '名称', 'en-US': 'Name'},
      dataType: 'string',
      required: true,
      indexed: true,
    },
    {
      apiName: 'country',
      displayName: {'zh-CN': '国家', 'en-US': 'Country'},
      dataType: 'string',
      indexed: true,
    },
    {
      apiName: 'riskScore',
      displayName: {'zh-CN': '风险分', 'en-US': 'Risk score'},
      dataType: 'double',
      indexed: true,
      semanticTags: ['risk'],
    },
    {
      apiName: 'capacity',
      displayName: {'zh-CN': '产能', 'en-US': 'Capacity'},
      dataType: 'double',
      unit: 'units/day',
      indexed: true,
    },
    {
      apiName: 'onTimeRate',
      displayName: {'zh-CN': '准时率', 'en-US': 'On-time rate'},
      dataType: 'double',
    },
    {
      apiName: 'status',
      displayName: {'zh-CN': '状态', 'en-US': 'Status'},
      dataType: 'enum',
      enumValues: ['active', 'watch', 'suspended'],
      indexed: true,
    },
    {
      apiName: 'contactEmail',
      displayName: {'zh-CN': '联系邮箱', 'en-US': 'Contact email'},
      dataType: 'string',
      sensitive: true,
      markings: ['PII'],
    },
  ],
};

export const materialType: ObjectTypeDef = {
  apiName: 'Material',
  displayName: {'zh-CN': '物料', 'en-US': 'Material'},
  icon: 'package',
  primaryKey: 'materialId',
  titleProperty: 'name',
  graphProjected: true,
  properties: [
    {
      apiName: 'materialId',
      displayName: {'zh-CN': '物料编号', 'en-US': 'Material ID'},
      dataType: 'string',
      required: true,
    },
    {
      apiName: 'name',
      displayName: {'zh-CN': '名称', 'en-US': 'Name'},
      dataType: 'string',
      required: true,
      indexed: true,
    },
    {
      apiName: 'category',
      displayName: {'zh-CN': '类别', 'en-US': 'Category'},
      dataType: 'string',
      indexed: true,
    },
    {
      apiName: 'unitCost',
      displayName: {'zh-CN': '单价', 'en-US': 'Unit cost'},
      dataType: 'double',
      unit: 'CNY',
      markings: ['FINANCE'],
    },
  ],
};

export const productType: ObjectTypeDef = {
  apiName: 'Product',
  displayName: {'zh-CN': '产品', 'en-US': 'Product'},
  icon: 'box',
  primaryKey: 'productId',
  titleProperty: 'name',
  graphProjected: true,
  properties: [
    {
      apiName: 'productId',
      displayName: {'zh-CN': '产品编号', 'en-US': 'Product ID'},
      dataType: 'string',
      required: true,
    },
    {
      apiName: 'name',
      displayName: {'zh-CN': '名称', 'en-US': 'Name'},
      dataType: 'string',
      required: true,
      indexed: true,
    },
    {
      apiName: 'dailyDemand',
      displayName: {'zh-CN': '日需求', 'en-US': 'Daily demand'},
      dataType: 'double',
      unit: 'units',
      indexed: true,
    },
    {
      apiName: 'inventoryDays',
      displayName: {'zh-CN': '库存天数', 'en-US': 'Inventory days'},
      dataType: 'double',
      unit: 'd',
      indexed: true,
    },
    {
      apiName: 'safetyStockDays',
      displayName: {'zh-CN': '安全库存天数', 'en-US': 'Safety stock days'},
      dataType: 'double',
      unit: 'd',
    },
    {
      apiName: 'revenuePerUnit',
      displayName: {'zh-CN': '单位收入', 'en-US': 'Revenue per unit'},
      dataType: 'double',
      unit: 'CNY',
      markings: ['FINANCE'],
    },
  ],
};

export const linkTypes: LinkTypeDef[] = [
  {
    apiName: 'supplies',
    displayName: {'zh-CN': '供应', 'en-US': 'Supplies'},
    from: 'Supplier',
    to: 'Material',
    cardinality: 'many',
    propagation: {defaultWeight: 1},
  },
  {
    apiName: 'usedIn',
    displayName: {'zh-CN': '用于', 'en-US': 'Used in'},
    from: 'Material',
    to: 'Product',
    cardinality: 'many',
    propagation: {defaultWeight: 1},
  },
];

export const actionTypes: ActionTypeDef[] = [
  {
    apiName: 'switchSupplier',
    displayName: {'zh-CN': '切换供应商', 'en-US': 'Switch supplier'},
    targetType: 'Material',
    parameters: [
      {
        apiName: 'newSupplier',
        displayName: {'zh-CN': '新供应商', 'en-US': 'New supplier'},
        dataType: 'objectRef:Supplier',
        required: true,
        suggest: {
          objectType: 'Supplier',
          filter: {
            op: 'and',
            args: [
              {op: 'eq', prop: 'status', value: 'active'},
              {op: 'lt', prop: 'riskScore', value: 50},
            ],
          },
          orderBy: {prop: 'riskScore', dir: 'asc'},
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
    requiresApproval: true,
    impact: [{property: 'capacity', change: 0.5}],
    writeback: {kind: 'none'},
  },
  {
    apiName: 'increaseSafetyStock',
    displayName: {'zh-CN': '提高安全库存', 'en-US': 'Increase safety stock'},
    targetType: 'Product',
    parameters: [
      {
        apiName: 'days',
        displayName: {'zh-CN': '增加天数', 'en-US': 'Extra days'},
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
        message: {
          'zh-CN': '增加天数须在 1–30 之间',
          'en-US': 'Extra days must be between 1 and 30',
        },
      },
    ],
    effects: [
      {kind: 'increment', prop: 'inventoryDays', by: {var: 'params.days'}},
      {kind: 'increment', prop: 'safetyStockDays', by: {var: 'params.days'}},
    ],
    requiresApproval: true,
    impact: [{property: 'inventoryDays', change: 0.3}],
    writeback: {kind: 'none'},
  },
  {
    apiName: 'flagSupplier',
    displayName: {'zh-CN': '标记观察', 'en-US': 'Flag supplier'},
    targetType: 'Supplier',
    parameters: [
      {
        apiName: 'reason',
        displayName: {'zh-CN': '原因', 'en-US': 'Reason'},
        dataType: 'string',
      },
    ],
    preconditions: [
      {
        expr: {'!==': [{var: 'target.status'}, 'suspended']},
        message: {
          'zh-CN': '已停用的供应商不能标记',
          'en-US': 'Suspended suppliers cannot be flagged',
        },
      },
    ],
    effects: [{kind: 'set', prop: 'status', value: 'watch'}],
    requiresApproval: false,
    writeback: {kind: 'none'},
  },
];

/** Supply-chain schema definition. */
export const supplyChainSchema: SchemaDef = {
  apiName: 'supplyChain',
  displayName: {'zh-CN': '供应链', 'en-US': 'Supply chain'},
  version: '1.0.0',
  objectTypes: [supplierType, materialType, productType],
  linkTypes,
  actionTypes,
  functions: [],
  simulationKpis: [
    {
      apiName: 'fulfillableDemand',
      displayName: {
        'zh-CN': '可满足日需求',
        'en-US': 'Fulfillable daily demand',
      },
      objectType: 'Product',
      property: 'dailyDemand',
      agg: 'sum',
      unit: 'units',
      higherIsBetter: true,
    },
    {
      apiName: 'healthyProducts',
      displayName: {'zh-CN': '未受影响产品数', 'en-US': 'Unaffected products'},
      objectType: 'Product',
      agg: 'count',
      higherIsBetter: true,
    },
  ],
};

function compile(ot: ObjectTypeDef): CompiledObjectType {
  return {
    ...ot,
    schemaApi: 'supplyChain',
    propsByName: Object.fromEntries(ot.properties.map(p => [p.apiName, p])),
    indexedProps: ot.properties.filter(p => p.indexed).map(p => p.apiName),
    sensitiveProps: ot.properties.filter(p => p.sensitive).map(p => p.apiName),
  };
}

/** Active compiled model. */
export const compiledModel: CompiledModel = {
  tenantId: T,
  version: '1.0.0',
  hash: 'h-1',
  schemas: [{apiName: 'supplyChain', version: '1.0.0'}],
  objectTypes: Object.fromEntries(
    supplyChainSchema.objectTypes.map(o => [o.apiName, compile(o)]),
  ),
  linkTypes: Object.fromEntries(linkTypes.map(l => [l.apiName, l])),
  actionTypes: Object.fromEntries(actionTypes.map(a => [a.apiName, a])),
  functions: {},
  simulationKpis: supplyChainSchema.simulationKpis ?? [],
  indexPlan: [],
};

export const schemaSummaries: SchemaSummary[] = [
  {
    apiName: 'supplyChain',
    displayName: supplyChainSchema.displayName,
    currentVersion: '1.0.0',
    hasDraft: false,
    objectTypeCount: 3,
    publishedAt: NOW,
  },
];

export const packs: PackSummary[] = [
  {
    id: 'supply-chain',
    name: {'zh-CN': '供应链风险监测', 'en-US': 'Supply chain risk monitoring'},
    version: '1.0.0',
    description: {
      'zh-CN': '供应商、物料与产品的风险传播、预警与处置建议。',
      'en-US': 'Risk propagation across suppliers, materials and products.',
    },
    builtIn: true,
  },
];

// ----------------------------------------------------------------------------
// Objects
// ----------------------------------------------------------------------------

const prov = (sourceId: string, recordRef: string) => ({
  sourceId,
  datasetTxn: 'job-1',
  recordRef,
  ingestedAt: NOW,
  confidence: 0.95,
});

function obj(
  type: string,
  id: string,
  pk: string,
  title: string,
  props: Record<string, unknown>,
  sourceId: string,
  hidden: string[] = [],
): ObjectDto {
  return {
    rid: rid(type, id),
    type,
    primaryKey: pk,
    title,
    props,
    provenance: Object.fromEntries(
      Object.keys(props).map(k => [k, prov(sourceId, `${pk}#row`)]),
    ),
    version: 3,
    schemaVersion: '1.0.0',
    updatedAt: NOW,
    hiddenProps: hidden,
  };
}

export const suppliers: ObjectDto[] = [
  obj(
    'Supplier',
    'S001',
    'S-001',
    'Shenzhen Precision Parts',
    {
      supplierId: 'S-001',
      name: 'Shenzhen Precision Parts',
      country: 'CN',
      riskScore: 35,
      capacity: 1200,
      onTimeRate: 0.96,
      status: 'active',
      contactEmail: 'ops@szpp.example',
    },
    'src-suppliers',
  ),
  obj(
    'Supplier',
    'S002',
    'S-002',
    'Hanoi Circuit Works',
    {
      supplierId: 'S-002',
      name: 'Hanoi Circuit Works',
      country: 'VN',
      riskScore: 78,
      capacity: 800,
      onTimeRate: 0.91,
      status: 'active',
      contactEmail: 'sales@hcw.example',
    },
    'src-suppliers',
  ),
  obj(
    'Supplier',
    'S003',
    'S-003',
    'Penang Semicon',
    {
      supplierId: 'S-003',
      name: 'Penang Semicon',
      country: 'MY',
      riskScore: 22,
      capacity: 1500,
      onTimeRate: 0.98,
      status: 'active',
      contactEmail: 'contact@penang.example',
    },
    'src-suppliers',
  ),
  obj(
    'Supplier',
    'S004',
    'S-004',
    'Osaka Metals',
    {
      supplierId: 'S-004',
      name: 'Osaka Metals',
      country: 'JP',
      riskScore: 48,
      capacity: 950,
      onTimeRate: 0.94,
      status: 'watch',
    },
    'src-suppliers',
    ['contactEmail'],
  ),
];

export const materials: ObjectDto[] = [
  obj(
    'Material',
    'M100',
    'M-100',
    'Aluminium housing',
    {
      materialId: 'M-100',
      name: 'Aluminium housing',
      category: 'Mechanical',
      unitCost: 42.5,
    },
    'src-materials',
  ),
  obj(
    'Material',
    'M101',
    'M-101',
    'Controller PCB',
    {
      materialId: 'M-101',
      name: 'Controller PCB',
      category: 'Electronics',
      unitCost: 88,
    },
    'src-materials',
  ),
  obj(
    'Material',
    'M102',
    'M-102',
    'Power IC',
    {
      materialId: 'M-102',
      name: 'Power IC',
      category: 'Electronics',
      unitCost: 12.3,
    },
    'src-materials',
  ),
];

export const products: ObjectDto[] = [
  obj(
    'Product',
    'P900',
    'P-900',
    'Edge Gateway X1',
    {
      productId: 'P-900',
      name: 'Edge Gateway X1',
      dailyDemand: 320,
      inventoryDays: 12,
      safetyStockDays: 5,
      revenuePerUnit: 1299,
    },
    'src-products',
  ),
  obj(
    'Product',
    'P901',
    'P-901',
    'Handheld Scanner S2',
    {
      productId: 'P-901',
      name: 'Handheld Scanner S2',
      dailyDemand: 180,
      inventoryDays: 4,
      safetyStockDays: 4,
      revenuePerUnit: 899,
    },
    'src-products',
  ),
  obj(
    'Product',
    'P902',
    'P-902',
    'Smart Sensor Hub',
    {
      productId: 'P-902',
      name: 'Smart Sensor Hub',
      dailyDemand: 450,
      inventoryDays: 9,
      safetyStockDays: 5,
      revenuePerUnit: 459,
    },
    'src-products',
  ),
];

export const allObjects: ObjectDto[] = [
  ...suppliers,
  ...materials,
  ...products,
];

/** Edges of the sample graph. */
export const edges: {type: string; src: Rid; dst: Rid; weight?: number}[] = [
  {
    type: 'supplies',
    src: rid('Supplier', 'S001'),
    dst: rid('Material', 'M100'),
    weight: 0.7,
  },
  {
    type: 'supplies',
    src: rid('Supplier', 'S001'),
    dst: rid('Material', 'M101'),
    weight: 0.7,
  },
  {
    type: 'supplies',
    src: rid('Supplier', 'S002'),
    dst: rid('Material', 'M101'),
    weight: 0.3,
  },
  {
    type: 'supplies',
    src: rid('Supplier', 'S002'),
    dst: rid('Material', 'M102'),
    weight: 0.3,
  },
  {
    type: 'supplies',
    src: rid('Supplier', 'S003'),
    dst: rid('Material', 'M102'),
    weight: 0.7,
  },
  {type: 'usedIn', src: rid('Material', 'M100'), dst: rid('Product', 'P900')},
  {type: 'usedIn', src: rid('Material', 'M100'), dst: rid('Product', 'P901')},
  {type: 'usedIn', src: rid('Material', 'M101'), dst: rid('Product', 'P900')},
  {type: 'usedIn', src: rid('Material', 'M102'), dst: rid('Product', 'P900')},
  {type: 'usedIn', src: rid('Material', 'M102'), dst: rid('Product', 'P902')},
];

/** Lineage for an object. */
export function lineageOf(o: ObjectDto): LineageDto {
  return {
    rid: o.rid,
    props: Object.fromEntries(
      Object.entries(o.props).map(([k, v]) => [
        k,
        {
          value: v,
          current: o.provenance[k] ?? null,
          history: [
            {
              ...prov('src-legacy', `${o.primaryKey}#old`),
              ingestedAt: '2026-09-20T00:00:00.000Z',
              confidence: 0.8,
              value: v,
            },
          ],
        },
      ]),
    ),
  };
}

export const actionLog: ActionLogDto[] = [
  {
    id: 'al-1',
    actionType: 'flagSupplier',
    targetRid: rid('Supplier', 'S002'),
    params: {reason: 'late deliveries'},
    before: {status: 'active'},
    after: {status: 'watch'},
    actor: 'operator',
    writebackStatus: 'NONE',
    executedAt: '2026-09-23T10:00:00.000Z',
  },
];

// ----------------------------------------------------------------------------
// Situation
// ----------------------------------------------------------------------------

const spark = (base: number, step: number) =>
  Array.from({length: 24}, (_, i) => base + Math.round(Math.sin(i / 3) * step));

export const kpis: KpiValue[] = [
  {
    id: 'kpi-high-risk',
    name: {'zh-CN': '高风险供应商', 'en-US': 'High-risk suppliers'},
    value: 1,
    previous: 0,
    target: 0,
    unit: null,
    higherIsBetter: false,
    spark: spark(1, 1),
    updatedAt: NOW,
  },
  {
    id: 'kpi-avg-risk',
    name: {'zh-CN': '平均供应商风险', 'en-US': 'Average supplier risk'},
    value: 45.8,
    previous: 41.2,
    target: 40,
    unit: null,
    higherIsBetter: false,
    spark: spark(44, 3),
    updatedAt: NOW,
  },
  {
    id: 'kpi-at-risk',
    name: {'zh-CN': '缺货风险产品', 'en-US': 'Products at risk'},
    value: 1,
    previous: 2,
    target: 0,
    unit: null,
    higherIsBetter: false,
    spark: spark(2, 1),
    updatedAt: NOW,
  },
  {
    id: 'kpi-demand',
    name: {'zh-CN': '日需求总量', 'en-US': 'Total daily demand'},
    value: 950,
    previous: 910,
    target: null,
    unit: 'units',
    higherIsBetter: true,
    spark: spark(930, 20),
    updatedAt: NOW,
  },
];

export const alerts: AlertDto[] = [
  {
    id: 'al-risk-s002',
    automationId: 'auto-risk',
    automationName: {'zh-CN': '供应商风险过高', 'en-US': 'Supplier risk high'},
    rid: rid('Supplier', 'S002'),
    title: 'Hanoi Circuit Works riskScore 78',
    severity: 'HIGH',
    status: 'OPEN',
    snapshot: {riskScore: 78},
    hits: 2,
    raisedAt: '2026-09-24T07:40:00.000Z',
    recommendationId: 'rec-1',
  },
  {
    id: 'al-inv-p901',
    automationId: 'auto-inv',
    automationName: {'zh-CN': '库存不足', 'en-US': 'Low inventory'},
    rid: rid('Product', 'P901'),
    title: 'Handheld Scanner S2 inventoryDays 4',
    severity: 'MEDIUM',
    status: 'OPEN',
    snapshot: {inventoryDays: 4},
    hits: 1,
    raisedAt: '2026-09-24T06:10:00.000Z',
  },
  {
    id: 'al-old',
    automationId: 'auto-inv',
    automationName: {'zh-CN': '库存不足', 'en-US': 'Low inventory'},
    rid: rid('Product', 'P902'),
    title: 'Smart Sensor Hub inventoryDays 4.5',
    severity: 'LOW',
    status: 'ACKED',
    snapshot: {inventoryDays: 4.5},
    hits: 1,
    raisedAt: '2026-09-23T06:10:00.000Z',
    ackedBy: 'operator',
  },
];

export const usage: UsageStatus = {
  day: '2026-09-24',
  level: 'warn',
  ratios: {
    'workers.requests': 0.42,
    'd1.rowsWritten': 0.83,
    'd1.rowsRead': 0.12,
    'queues.ops': 0.3,
    'kv.writes': 0.05,
    'ai.neurons': 0.61,
    'do.requests': 0.2,
  },
  used: {
    'workers.requests': 42000,
    'd1.rowsWritten': 83000,
    'd1.rowsRead': 600000,
    'queues.ops': 3000,
    'kv.writes': 50,
    'ai.neurons': 6100,
    'do.requests': 20000,
  },
};

export const recSummaries: RecommendationSummary[] = [
  {
    id: 'rec-1',
    status: 'Proposed',
    summary: '将 Controller PCB 切换到 Penang Semicon，预计恢复 22% 可满足需求',
    confidence: 0.82,
    focus: rid('Supplier', 'S002'),
    alertId: 'al-risk-s002',
    expectedImpact: 0.22,
    createdAt: '2026-09-24T07:42:00.000Z',
    expiresAt: '2026-09-25T07:42:00.000Z',
  },
];

export const dataHealth: DataHealthDto[] = [
  {
    sourceId: 'src-suppliers',
    name: 'suppliers.csv',
    kind: 'file',
    enabled: true,
    lastJobAt: NOW,
    lastStatus: 'Succeeded',
    qualityScore: 0.98,
    stale: false,
  },
  {
    sourceId: 'src-materials',
    name: 'materials.csv',
    kind: 'file',
    enabled: true,
    lastJobAt: NOW,
    lastStatus: 'PartiallyFailed',
    qualityScore: 0.9,
    stale: false,
  },
  {
    sourceId: 'src-products',
    name: 'products.csv',
    kind: 'file',
    enabled: true,
    lastJobAt: '2026-09-22T08:00:00.000Z',
    lastStatus: 'Succeeded',
    qualityScore: 1,
    stale: true,
  },
];

export const overview: Overview = {
  kpis,
  alerts,
  usage,
  recommendations: recSummaries,
  generatedAt: NOW,
  dataHealth,
};

export const layout: CockpitLayout = {
  id: 'default',
  name: 'Default',
  columns: 12,
  widgets: [
    {id: 'w-kpi', kind: 'kpi', x: 0, y: 0, w: 12, h: 2},
    {
      id: 'w-trend',
      kind: 'trend',
      x: 0,
      y: 2,
      w: 8,
      h: 4,
      binding: {kpiId: 'kpi-avg-risk'},
    },
    {id: 'w-alerts', kind: 'alerts', x: 8, y: 2, w: 4, h: 4},
    {id: 'w-recs', kind: 'recommendations', x: 0, y: 6, w: 4, h: 4},
    {id: 'w-impacted', kind: 'impacted', x: 4, y: 6, w: 4, h: 4},
    {id: 'w-health', kind: 'dataHealth', x: 8, y: 6, w: 4, h: 4},
  ],
};

export const automations: AutomationDto[] = [
  {
    id: 'auto-risk',
    name: {'zh-CN': '供应商风险过高', 'en-US': 'Supplier risk high'},
    trigger: {kind: 'threshold', objectType: 'Supplier'},
    condition: {op: 'gte', prop: 'riskScore', value: 70},
    effects: [
      {kind: 'alert'},
      {kind: 'recommend', perturbation: {property: 'capacity', change: -0.6}},
    ],
    severity: 'HIGH',
    cooldownSec: 3600,
    enabled: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    lastFiredAt: '2026-09-24T07:40:00.000Z',
  },
  {
    id: 'auto-inv',
    name: {'zh-CN': '库存不足', 'en-US': 'Low inventory'},
    trigger: {kind: 'threshold', objectType: 'Product'},
    condition: {op: 'lt', prop: 'inventoryDays', value: 5},
    effects: [{kind: 'alert'}],
    severity: 'MEDIUM',
    cooldownSec: 3600,
    enabled: true,
    createdAt: '2026-09-01T00:00:00.000Z',
  },
];

export const deadLetters: DeadLetterDto[] = [
  {
    id: 'dl-1',
    queue: 'object-writes-dlq',
    body: {jobId: 'job-9', seq: 3},
    attempts: 3,
    receivedAt: '2026-09-24T05:00:00.000Z',
  },
  {
    id: 'dl-2',
    queue: 'decision-jobs-dlq',
    body: {jobId: 'rec-9'},
    attempts: 3,
    receivedAt: '2026-09-24T06:00:00.000Z',
  },
];

// ----------------------------------------------------------------------------
// Decision
// ----------------------------------------------------------------------------

export const scenarioResult: ScenarioResult = {
  baseline: {fulfillableDemand: 950, healthyProducts: 3},
  scenario: {fulfillableDemand: 610, healthyProducts: 1},
  withActions: {
    [`switchSupplier:${rid('Material', 'M101')}`]: {
      fulfillableDemand: 880,
      healthyProducts: 2,
    },
  },
  affected: [
    {
      rid: rid('Supplier', 'S002'),
      type: 'Supplier',
      title: 'Hanoi Circuit Works',
      delta: -0.6,
      hop: 0,
    },
    {
      rid: rid('Material', 'M101'),
      type: 'Material',
      title: 'Controller PCB',
      delta: -0.3,
      hop: 1,
    },
    {
      rid: rid('Material', 'M102'),
      type: 'Material',
      title: 'Power IC',
      delta: -0.2,
      hop: 1,
    },
    {
      rid: rid('Product', 'P900'),
      type: 'Product',
      title: 'Edge Gateway X1',
      delta: -0.35,
      hop: 2,
    },
    {
      rid: rid('Product', 'P902'),
      type: 'Product',
      title: 'Smart Sensor Hub',
      delta: -0.12,
      hop: 2,
    },
  ],
  riskLevel: 'HIGH',
  kpis: [
    {
      apiName: 'fulfillableDemand',
      displayName: {
        'zh-CN': '可满足日需求',
        'en-US': 'Fulfillable daily demand',
      },
      unit: 'units',
      higherIsBetter: true,
    },
    {
      apiName: 'healthyProducts',
      displayName: {'zh-CN': '未受影响产品数', 'en-US': 'Unaffected products'},
      higherIsBetter: true,
    },
  ],
  nodeCount: 6,
  degraded: false,
  computedAt: NOW,
};

export const scenarios: ScenarioDto[] = [
  {
    id: 'sc-1',
    name: 'Hanoi capacity −60%',
    perturbations: [
      {rid: rid('Supplier', 'S002'), property: 'capacity', change: -0.6},
    ],
    result: scenarioResult,
    createdBy: 'operator',
    createdAt: '2026-09-24T07:45:00.000Z',
  },
];

export const recommendation: RecommendationDto = {
  id: 'rec-1',
  status: 'Proposed',
  focus: rid('Supplier', 'S002'),
  alertId: 'al-risk-s002',
  summary: '将 Controller PCB 切换到 Penang Semicon，预计恢复 22% 可满足需求',
  rationale:
    'Hanoi Circuit Works 风险分 78，供应 Controller PCB 与 Power IC；Penang Semicon 风险分 22 且产能充足。',
  actions: [
    {
      actionType: 'switchSupplier',
      displayName: {'zh-CN': '切换供应商', 'en-US': 'Switch supplier'},
      target: rid('Material', 'M101'),
      params: {newSupplier: rid('Supplier', 'S003')},
      expectedImpact: 0.22,
      rank: 1,
      requiresApproval: true,
    },
    {
      actionType: 'increaseSafetyStock',
      displayName: {'zh-CN': '提高安全库存', 'en-US': 'Increase safety stock'},
      target: rid('Product', 'P900'),
      params: {days: 7},
      expectedImpact: 0.08,
      rank: 2,
      requiresApproval: true,
    },
  ],
  evidence: [
    {
      rid: rid('Supplier', 'S002'),
      prop: 'riskScore',
      value: 78,
      provenance: prov('src-suppliers', 'S-002#row'),
    },
    {
      rid: rid('Supplier', 'S003'),
      prop: 'capacity',
      value: 1500,
      provenance: prov('src-suppliers', 'S-003#row'),
    },
  ],
  risks: ['切换期间 3 天交付能力下降', 'Penang Semicon 需完成来料检验'],
  confidence: 0.82,
  model: '@cf/meta/llama-3.1-8b-instruct',
  degraded: false,
  simulation: scenarioResult,
  locale: 'zh-CN',
  createdAt: '2026-09-24T07:42:00.000Z',
  expiresAt: '2026-09-25T07:42:00.000Z',
};

// ----------------------------------------------------------------------------
// Integration
// ----------------------------------------------------------------------------

export const sources: SourceDto[] = [
  {
    id: 'src-suppliers',
    tenantId: T,
    name: 'suppliers.csv',
    kind: 'file',
    config: {format: 'csv'},
    mapping: {
      targetType: 'Supplier',
      primaryKey: {from: 'supplierId'},
      fields: [
        {to: 'name', from: 'name', transform: 'trim'},
        {
          to: 'riskScore',
          from: 'riskScore',
          transform: 'toNumber|clamp(0,100)',
        },
      ],
      links: [
        {
          type: 'supplies',
          toType: 'Material',
          toKey: 'materials',
          split: ';',
          weightFrom: 'share',
        },
      ],
    },
    qualityRules: [
      {prop: 'riskScore', kind: 'range', arg: [0, 100], onFail: 'clamp'},
    ],
    conflictPolicy: 'latest-wins',
    enabled: true,
    cursor: null,
    createdAt: '2026-09-20T00:00:00.000Z',
    lastJobAt: NOW,
  },
];

export const jobs: JobDto[] = [
  {
    id: 'job-1',
    tenantId: T,
    sourceId: 'src-suppliers',
    txnType: 'APPEND',
    status: 'PartiallyFailed',
    received: 10,
    upserted: 7,
    merged: 1,
    skipped: 0,
    rejected: 2,
    qualityScore: 0.8,
    startedAt: '2026-09-24T07:00:00.000Z',
    finishedAt: '2026-09-24T07:01:00.000Z',
    totalGroups: 1,
    doneGroups: 1,
  },
];

export const rejected: RawRecordDto[] = [
  {
    id: 'rr-1',
    jobId: 'job-1',
    rowNo: 4,
    payload: {supplierId: 'S-009', name: '', riskScore: 'abc'},
    errorCode: 'TYPE',
    errorDetail: 'riskScore is not a number',
    createdAt: NOW,
  },
  {
    id: 'rr-2',
    jobId: 'job-1',
    rowNo: 7,
    payload: {supplierId: '', name: 'Nameless Co', riskScore: 50},
    errorCode: 'REQUIRED',
    errorDetail: 'supplierId is required',
    createdAt: NOW,
  },
];
