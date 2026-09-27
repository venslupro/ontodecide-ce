/**
 * @fileoverview Test fixtures for business data built from the contract
 * DTOs: the supply-chain ontology, objects and links, cockpit overview,
 * alerts, automations, recommendations, scenarios and import jobs.
 */

import type {
  Candidate,
  RecommendationDto,
  ScenarioDto,
} from '@ontodecide/decision/contract';
import type {JobDto} from '@ontodecide/integration/contract';
import type {
  ActionLogDto,
  GraphEdge,
  ObjectDto,
} from '@ontodecide/object-graph/contract';
import type {OntologyDef, OntologyDto} from '@ontodecide/ontology/contract';
import type {Quotas, Rid} from '@ontodecide/shared-kernel';
import type {
  AlertDto,
  AutomationDto,
  KpiValue,
  SituationOverview,
} from '@ontodecide/situation/contract';

/** Fixed "now" used by the fixtures. */
export const FIXTURE_NOW = Date.parse('2026-09-28T09:44:00Z');

const iso = (msAgo: number) => new Date(FIXTURE_NOW - msAgo).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

/** Builds a valid RID (`ri.<Type>.<26 × [0-9A-Z]>`). */
export function rid(type: string, n: number): Rid {
  return `ri.${type}.01J9${String(n).padStart(22, '0')}` as Rid;
}

/** Supply-chain ontology definition. */
export const ontologyDef: OntologyDef = {
  objectTypes: [
    {
      apiName: 'Supplier',
      displayName: {'zh-CN': '供应商', 'en-US': 'Supplier'},
      icon: 'factory',
      primaryKey: 'supplierId',
      titleProperty: 'name',
      properties: [
        {
          apiName: 'supplierId',
          displayName: {'zh-CN': '供应商编号', 'en-US': 'Supplier ID'},
          dataType: 'string',
          required: true,
          indexed: true,
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
        },
        {
          apiName: 'riskScore',
          displayName: {'zh-CN': '风险分', 'en-US': 'Risk score'},
          dataType: 'double',
          indexed: true,
          semanticTags: ['risk'],
        },
        {
          apiName: 'onTimeRate',
          displayName: {'zh-CN': '准时率', 'en-US': 'On-time rate'},
          dataType: 'double',
          unit: '%',
        },
        {
          apiName: 'capacityPerWeek',
          displayName: {'zh-CN': '周产能', 'en-US': 'Capacity / week'},
          dataType: 'integer',
          unit: 'pcs/wk',
          indexed: true,
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
          displayName: {'zh-CN': '联系邮箱', 'en-US': 'Contact e-mail'},
          dataType: 'string',
          sensitive: true,
        },
      ],
    },
    {
      apiName: 'Material',
      displayName: {'zh-CN': '物料', 'en-US': 'Material'},
      primaryKey: 'sku',
      titleProperty: 'sku',
      properties: [
        {
          apiName: 'sku',
          displayName: {'zh-CN': '物料编码', 'en-US': 'SKU'},
          dataType: 'string',
          required: true,
          indexed: true,
        },
        {
          apiName: 'onHand',
          displayName: {'zh-CN': '在库量', 'en-US': 'On hand'},
          dataType: 'integer',
          indexed: true,
        },
        {
          apiName: 'safetyStock',
          displayName: {'zh-CN': '安全库存', 'en-US': 'Safety stock'},
          dataType: 'integer',
        },
        {
          apiName: 'daysOfSupply',
          displayName: {'zh-CN': '可供天数', 'en-US': 'Days of supply'},
          dataType: 'double',
          unit: 'd',
          semanticTags: ['risk'],
          indexed: true,
        },
      ],
    },
    {
      apiName: 'Plant',
      displayName: {'zh-CN': '工厂', 'en-US': 'Plant'},
      primaryKey: 'plantId',
      titleProperty: 'name',
      properties: [
        {
          apiName: 'plantId',
          displayName: {'zh-CN': '工厂编号', 'en-US': 'Plant ID'},
          dataType: 'string',
          required: true,
        },
        {
          apiName: 'name',
          displayName: {'zh-CN': '名称', 'en-US': 'Name'},
          dataType: 'string',
          required: true,
        },
        {
          apiName: 'utilization',
          displayName: {'zh-CN': '利用率', 'en-US': 'Utilization'},
          dataType: 'double',
          unit: '%',
        },
      ],
    },
    {
      apiName: 'PurchaseOrder',
      displayName: {'zh-CN': '采购订单', 'en-US': 'Purchase order'},
      primaryKey: 'poId',
      titleProperty: 'poId',
      properties: [
        {
          apiName: 'poId',
          displayName: {'zh-CN': '订单号', 'en-US': 'PO number'},
          dataType: 'string',
          required: true,
          indexed: true,
        },
        {
          apiName: 'supplier',
          displayName: {'zh-CN': '供应商', 'en-US': 'Supplier'},
          dataType: 'objectRef:Supplier',
        },
        {
          apiName: 'dueDate',
          displayName: {'zh-CN': '交期', 'en-US': 'Due date'},
          dataType: 'date',
        },
        {
          apiName: 'lateProbability',
          displayName: {'zh-CN': '逾期概率', 'en-US': 'Late probability'},
          dataType: 'double',
          semanticTags: ['risk'],
          indexed: true,
        },
      ],
    },
  ],
  linkTypes: [
    {
      apiName: 'supplies',
      displayName: {'zh-CN': '供应', 'en-US': 'Supplies'},
      from: 'Supplier',
      to: 'Material',
      cardinality: 'many',
      propagation: {defaultWeight: 0.8},
    },
    {
      apiName: 'usedAt',
      displayName: {'zh-CN': '用于', 'en-US': 'Used at'},
      from: 'Material',
      to: 'Plant',
      cardinality: 'many',
      propagation: {defaultWeight: 0.6},
    },
    {
      apiName: 'orders',
      displayName: {'zh-CN': '订购', 'en-US': 'Orders'},
      from: 'PurchaseOrder',
      to: 'Material',
      cardinality: 'many',
    },
  ],
  actionTypes: [
    {
      apiName: 'switchSupplier',
      displayName: {'zh-CN': '切换供应商', 'en-US': 'Switch supplier'},
      targetType: 'PurchaseOrder',
      parameters: [
        {
          apiName: 'newSupplier',
          displayName: {'zh-CN': '新供应商', 'en-US': 'New supplier'},
          dataType: 'objectRef:Supplier',
          required: true,
        },
      ],
      preconditions: [
        {
          expr: {'<': [{var: 'target.lateProbability'}, 0.99]},
          message: {'zh-CN': '订单已无法挽回', 'en-US': 'Order is lost'},
        },
      ],
      effects: [
        {kind: 'set', prop: 'supplier', value: {var: 'params.newSupplier'}},
      ],
      impact: [{property: 'lateProbability', change: -0.4}],
    },
    {
      apiName: 'adjustSafetyStock',
      displayName: {'zh-CN': '调整安全库存', 'en-US': 'Adjust safety stock'},
      targetType: 'Material',
      parameters: [
        {
          apiName: 'delta',
          displayName: {'zh-CN': '调整量', 'en-US': 'Delta'},
          dataType: 'integer',
          required: true,
          defaultValue: 100,
        },
      ],
      preconditions: [],
      effects: [
        {kind: 'increment', prop: 'safetyStock', by: {var: 'params.delta'}},
      ],
    },
    {
      apiName: 'suspendSupplier',
      displayName: {'zh-CN': '暂停供应商', 'en-US': 'Suspend supplier'},
      targetType: 'Supplier',
      parameters: [],
      preconditions: [
        {
          expr: {'!=': [{var: 'target.status'}, 'suspended']},
          message: {'zh-CN': '供应商已暂停', 'en-US': 'Already suspended'},
        },
      ],
      effects: [{kind: 'set', prop: 'status', value: 'suspended'}],
    },
    {
      apiName: 'reactivateSupplier',
      displayName: {'zh-CN': '恢复供应商', 'en-US': 'Reactivate supplier'},
      targetType: 'Supplier',
      parameters: [],
      preconditions: [
        {
          expr: {'==': [{var: 'target.status'}, 'suspended']},
          message: {'zh-CN': '供应商未暂停', 'en-US': 'Not suspended'},
        },
      ],
      effects: [{kind: 'set', prop: 'status', value: 'active'}],
    },
  ],
  functions: [],
  simulationKpis: [
    {
      apiName: 'onTimeRate',
      displayName: {'zh-CN': '准时交付率', 'en-US': 'On-time delivery'},
      objectType: 'Supplier',
      property: 'onTimeRate',
      agg: 'avg',
      unit: '%',
      higherIsBetter: true,
    },
    {
      apiName: 'shortageOrders',
      displayName: {'zh-CN': '缺料风险订单', 'en-US': 'Orders at risk'},
      objectType: 'PurchaseOrder',
      agg: 'count',
      higherIsBetter: false,
    },
  ],
};

/** `GET /ontology` (still the template). */
export const ontologyDto: OntologyDto = {
  templateId: 'supply-chain',
  templateVersion: '1.0.0',
  custom: false,
  etag: 0,
  definition: ontologyDef,
  updatedAt: null,
};

// --- Objects ---------------------------------------------------------------

/** Main supplier (the Object View mockup). */
export const S017 = rid('Supplier', 17);
/** Alternative supplier. */
export const S022 = rid('Supplier', 22);
/** Material M-2231. */
export const M2231 = rid('Material', 2231);
/** Plant 华东一厂. */
export const P01 = rid('Plant', 1);
/** Purchase order PO-5530. */
export const PO5530 = rid('PurchaseOrder', 5530);

const prov = (row: number, minAgo: number) => ({
  jobId: 'imp-0412',
  row,
  at: FIXTURE_NOW - minAgo * MIN,
});

/** Builds the fixture objects (fresh copies). */
export function makeObjects(): ObjectDto[] {
  const objs: ObjectDto[] = [
    {
      rid: S017,
      type: 'Supplier',
      primaryKey: 'S-017',
      title: '苏州精密零件有限公司',
      props: {
        supplierId: 'S-017',
        name: '苏州精密零件有限公司',
        country: 'CN',
        riskScore: 82,
        onTimeRate: 86.2,
        capacityPerWeek: 4000,
        status: 'watch',
      },
      provenance: {
        supplierId: prov(3, 120),
        country: prov(3, 120),
        riskScore: prov(3, 10),
        capacityPerWeek: prov(3, 2),
      },
      version: 14,
      updatedAt: iso(2 * MIN),
    },
    {
      rid: S022,
      type: 'Supplier',
      primaryKey: 'S-022',
      title: '宁波恒达机电',
      props: {
        supplierId: 'S-022',
        name: '宁波恒达机电',
        country: 'CN',
        riskScore: 21,
        onTimeRate: 97.1,
        capacityPerWeek: 9000,
        status: 'active',
      },
      provenance: {},
      version: 3,
      updatedAt: iso(5 * HOUR),
    },
    {
      rid: M2231,
      type: 'Material',
      primaryKey: 'M-2231',
      title: 'M-2231',
      props: {
        sku: 'M-2231',
        onHand: 1850,
        safetyStock: 2000,
        daysOfSupply: 1.6,
      },
      provenance: {onHand: prov(8, 15)},
      version: 7,
      updatedAt: iso(15 * MIN),
    },
    {
      rid: P01,
      type: 'Plant',
      primaryKey: 'P-01',
      title: '华东一厂',
      props: {plantId: 'P-01', name: '华东一厂', utilization: 71},
      provenance: {},
      version: 2,
      updatedAt: iso(HOUR),
    },
    {
      rid: PO5530,
      type: 'PurchaseOrder',
      primaryKey: 'PO-5530',
      title: 'PO-5530',
      props: {
        poId: 'PO-5530',
        supplier: S017,
        dueDate: '2026-10-02',
        lateProbability: 0.71,
      },
      provenance: {},
      version: 5,
      updatedAt: iso(12 * MIN),
    },
  ];
  for (let i = 30; i < 36; i++) {
    objs.push({
      rid: rid('Supplier', i),
      type: 'Supplier',
      primaryKey: `S-0${i}`,
      title: `Supplier ${i}`,
      props: {
        supplierId: `S-0${i}`,
        name: `Supplier ${i}`,
        country: i % 2 ? 'JP' : 'CN',
        riskScore: 30 + i,
        onTimeRate: 90,
        capacityPerWeek: 1000 * (i - 28),
        status: 'active',
      },
      provenance: {},
      version: 1,
      updatedAt: iso(3 * HOUR),
    });
  }
  return objs;
}

/** Fixture links. */
export function makeLinks(): GraphEdge[] {
  return [
    {type: 'supplies', src: S017, dst: M2231, weight: 0.9},
    {type: 'supplies', src: S022, dst: M2231, weight: 0.5},
    {type: 'usedAt', src: M2231, dst: P01, weight: 0.7},
    {type: 'orders', src: PO5530, dst: M2231, weight: null},
  ];
}

/** Action audit of S-017. */
export function makeActionLog(): ActionLogDto[] {
  return [
    {
      id: 'al-1',
      actionType: 'adjustSafetyStock',
      targetRid: S017,
      params: {delta: 100},
      before: {capacityPerWeek: 10000},
      after: {capacityPerWeek: 4000},
      actor: 'owner',
      executedAt: iso(3 * MIN),
    },
  ];
}

// --- Situation -------------------------------------------------------------

/** KPI values. */
export function makeKpis(): KpiValue[] {
  return [
    {
      id: 'otd',
      name: {'zh-CN': '准时交付率', 'en-US': 'On-time delivery'},
      objectType: 'Supplier',
      aggregate: {fn: 'avg', prop: 'onTimeRate'},
      value: 91.4,
      previous: 93.5,
      target: 95,
      unit: '%',
      higherIsBetter: true,
      updatedAt: iso(MIN),
    },
    {
      id: 'shortage',
      name: {'zh-CN': '缺料风险订单', 'en-US': 'Orders at risk'},
      objectType: 'PurchaseOrder',
      aggregate: {fn: 'count'},
      value: 37,
      previous: 25,
      target: null,
      unit: null,
      higherIsBetter: false,
      updatedAt: iso(MIN),
    },
    {
      id: 'riskySuppliers',
      name: {'zh-CN': '高风险供应商', 'en-US': 'High-risk suppliers'},
      objectType: 'Supplier',
      aggregate: {fn: 'count'},
      value: 5,
      previous: 5,
      target: null,
      unit: null,
      higherIsBetter: false,
      updatedAt: iso(MIN),
    },
  ];
}

/** Alerts. */
export function makeAlerts(): AlertDto[] {
  return [
    {
      id: 'al-cap',
      automationId: 'auto-cap',
      automationName: {
        'zh-CN': '供应商产能下降',
        'en-US': 'Supplier capacity drop',
      },
      rid: S017,
      title: '供应商 S-017 产能下降 60%',
      severity: 'CRITICAL',
      status: 'OPEN',
      snapshot: {capacityPerWeek: 4000},
      hits: 1,
      raisedAt: iso(2 * MIN),
      ackedAt: null,
      closedAt: null,
    },
    {
      id: 'al-stock',
      automationId: 'auto-stock',
      automationName: {'zh-CN': '安全库存巡检', 'en-US': 'Safety stock check'},
      rid: M2231,
      title: '物料 M-2231 低于安全库存',
      severity: 'HIGH',
      status: 'OPEN',
      snapshot: {onHand: 1850},
      hits: 2,
      raisedAt: iso(5 * MIN),
      ackedAt: null,
      closedAt: null,
    },
    {
      id: 'al-po',
      automationId: 'auto-po',
      automationName: {'zh-CN': '订单逾期风险', 'en-US': 'Order delay risk'},
      rid: PO5530,
      title: 'PO-5530 逾期风险',
      severity: 'MEDIUM',
      status: 'ACKED',
      snapshot: {lateProbability: 0.71},
      hits: 1,
      raisedAt: iso(12 * MIN),
      ackedAt: iso(10 * MIN),
      closedAt: null,
    },
  ];
}

/** Automations. */
export function makeAutomations(): AutomationDto[] {
  return [
    {
      id: 'auto-cap',
      version: 1,
      name: {'zh-CN': '供应商产能下降', 'en-US': 'Supplier capacity drop'},
      trigger: 'threshold',
      objectType: 'Supplier',
      condition: {op: 'lt', prop: 'capacityPerWeek', value: 5000},
      severity: 'CRITICAL',
      cooldownSec: 3600,
      enabled: true,
      nextRunAt: null,
      lastFiredAt: iso(2 * MIN),
    },
    {
      id: 'auto-stock',
      version: 2,
      name: {'zh-CN': '安全库存巡检', 'en-US': 'Safety stock check'},
      trigger: 'schedule',
      everyHours: 1,
      objectType: 'Material',
      condition: {op: 'lt', prop: 'daysOfSupply', value: 2},
      severity: 'HIGH',
      cooldownSec: 3600,
      enabled: true,
      nextRunAt: iso(-30 * MIN),
      lastFiredAt: iso(5 * MIN),
    },
  ];
}

/** Candidates of the main recommendation. */
export const candidates: Candidate[] = [
  {
    id: 'c1',
    actionType: 'switchSupplier',
    displayName: {'zh-CN': '切换供应商', 'en-US': 'Switch supplier'},
    target: PO5530,
    targetTitle: 'PO-5530',
    params: {newSupplier: S022},
    expectedImpact: 0.12,
    affectedCount: 4,
  },
  {
    id: 'c2',
    actionType: 'adjustSafetyStock',
    displayName: {'zh-CN': '调整安全库存', 'en-US': 'Adjust safety stock'},
    target: M2231,
    targetTitle: 'M-2231',
    params: {delta: 400},
    expectedImpact: 0.05,
    affectedCount: 2,
  },
];

/** Recommendations. */
export function makeRecommendations(): RecommendationDto[] {
  return [
    {
      id: 'rec-203',
      status: 'Proposed',
      focus: S017,
      alertId: 'al-cap',
      scenarioId: 'scn-041',
      summary: 'PO-5530 切换至备选供应商 S-022',
      rationale:
        'S-017 产能下降 60% 将使 M-2231 在 1.6 天后缺料；S-022 风险分 21，可在 2 天内交付。',
      candidates,
      ranking: ['c1', 'c2'],
      evidence: [
        {
          rid: S017,
          prop: 'capacityPerWeek',
          value: 4000,
          provenance: {jobId: 'imp-0412', row: 3, at: FIXTURE_NOW - 2 * MIN},
        },
        {rid: M2231, prop: 'onHand', value: 1850},
      ],
      risks: ['单价上升约 3%', '首次合作批次需质检'],
      confidence: 0.78,
      rankedBy: 'ai',
      model: '@cf/qwen/qwen3-30b-a3b-fp8',
      locale: 'zh-CN',
      createdAt: iso(3 * MIN),
      expiresAt: iso(-21 * HOUR),
      version: 1,
    },
    {
      id: 'rec-204',
      status: 'Proposed',
      focus: M2231,
      summary: '提高 M-2231 安全库存',
      rationale: '规则排序：按预期收益与影响对象数排序。',
      candidates: [candidates[1]],
      ranking: ['c2'],
      evidence: [{rid: M2231, prop: 'onHand', value: 1850}],
      risks: [],
      confidence: 0.64,
      rankedBy: 'rules',
      locale: 'zh-CN',
      createdAt: iso(20 * MIN),
      expiresAt: iso(-23 * HOUR),
      version: 1,
    },
    {
      id: 'rec-190',
      status: 'Executed',
      focus: M2231,
      summary: '提高 M-2231 安全库存 20%',
      rationale: '…',
      candidates: [candidates[1]],
      ranking: ['c2'],
      evidence: [{rid: M2231, prop: 'onHand', value: 1500}],
      risks: [],
      confidence: 0.92,
      rankedBy: 'rules',
      decidedBy: 'owner',
      decidedAt: iso(20 * HOUR),
      execution: [{candidateId: 'c2', status: 'Executed', actionLogId: 'al-9'}],
      locale: 'zh-CN',
      createdAt: iso(22 * HOUR),
      expiresAt: iso(-2 * HOUR),
      version: 3,
    },
  ];
}

/** Stored scenario. */
export function makeScenario(): ScenarioDto {
  return {
    id: 'scn-041',
    name: 'S-017 产能下降影响评估',
    perturbations: [{rid: S017, property: 'capacityPerWeek', change: -0.6}],
    candidates,
    result: {
      baseline: {onTimeRate: 91.4, shortageOrders: 37},
      scenario: {onTimeRate: 84, shortageOrders: 61},
      withActions: {
        c1: {onTimeRate: 90.2, shortageOrders: 29},
        c2: {onTimeRate: 86, shortageOrders: 50},
      },
      affected: [
        {
          rid: S017,
          type: 'Supplier',
          title: '苏州精密零件',
          delta: -0.6,
          hop: 0,
        },
        {rid: M2231, type: 'Material', title: 'M-2231', delta: -0.42, hop: 1},
        {rid: P01, type: 'Plant', title: '华东一厂', delta: -0.18, hop: 2},
      ],
      riskLevel: 'HIGH',
      kpis: [
        {
          apiName: 'onTimeRate',
          displayName: {'zh-CN': '准时交付率', 'en-US': 'On-time delivery'},
          unit: '%',
          higherIsBetter: true,
        },
        {
          apiName: 'shortageOrders',
          displayName: {'zh-CN': '缺料风险订单', 'en-US': 'Orders at risk'},
          higherIsBetter: false,
        },
      ],
      nodeCount: 3,
      computedAt: iso(MIN),
    },
    createdAt: iso(MIN),
  };
}

/** Cockpit overview (situation part). */
export function makeOverview(): SituationOverview {
  const points = (base: number) =>
    Array.from({length: 12}, (_, i) => ({
      ts: iso((12 - i) * 2 * HOUR),
      value: base + Math.sin(i) * 2,
    }));
  return {
    kpis: makeKpis(),
    trends: [
      {kpiId: 'otd', points: points(92)},
      {kpiId: 'shortage', points: points(30)},
      {kpiId: 'riskySuppliers', points: points(5)},
    ],
    alerts: makeAlerts(),
    impacted: [
      {rid: P01, type: 'Plant', title: '华东一厂', delta: -0.18, hop: 2},
      {rid: M2231, type: 'Material', title: 'M-2231', delta: -0.42, hop: 1},
    ],
    initialized: true,
    generatedAt: iso(0),
  };
}

/** Personal quotas (GET /me .quotas). */
export function makeQuotas(): Quotas {
  return {
    objects: {used: 11, limit: 300},
    links: {used: 4, limit: 900},
    importRowsToday: {used: 820, limit: 2000},
    aiRecsToday: {used: 1, limit: 3},
    mappingDraftsToday: {used: 0, limit: 2},
    sessions: {used: 1, limit: 3},
    resetsAt: '2026-09-29T00:00:00.000Z',
  };
}

/** Import jobs. */
export function makeJobs(): JobDto[] {
  return [
    {
      id: 'imp-0412',
      kind: 'file',
      fileName: 'supplier_update.csv',
      targetType: 'Supplier',
      mapping: {
        targetType: 'Supplier',
        primaryKey: {from: 'vendor_code', transform: 'trim'},
        fields: [{to: 'name', from: 'vendor_name', transform: 'trim'}],
      },
      status: 'DONE',
      totalRows: 212,
      received: 212,
      upserted: 200,
      skipped: 5,
      rejected: 7,
      createdAt: iso(30 * MIN),
      updatedAt: iso(29 * MIN),
      rejects: [
        {row: 130, code: 'REQUIRED', column: 'vendor_code'},
        {row: 131, code: 'TYPE', column: 'risk', detail: 'Expected double'},
      ],
    },
    {
      id: 'imp-sample',
      kind: 'sample',
      fileName: null,
      targetType: 'Supplier',
      mapping: null,
      status: 'DONE',
      totalRows: 80,
      received: 80,
      upserted: 80,
      skipped: 0,
      rejected: 0,
      createdAt: iso(2 * HOUR),
      updatedAt: iso(2 * HOUR),
    },
  ];
}
