/**
 * @fileoverview Built-in "supply chain risk monitoring" ontology pack — the
 * MVP's first scenario. Automations and KPIs follow the situation contract
 * (AutomationDef / KpiDef) and are installed by situation-awareness.
 */

import type {OntologyPack} from '../../contract';

/** Built-in pack id. */
export const SUPPLY_CHAIN_PACK_ID = 'supply-chain';

/** The supply chain pack. */
export const SUPPLY_CHAIN_PACK: OntologyPack = {
  id: SUPPLY_CHAIN_PACK_ID,
  name: {'zh-CN': '供应链风险监测', 'en-US': 'Supply chain risk monitoring'},
  version: '1.0.0',
  description: {
    'zh-CN': '供应商、物料与产品的风险传播、预警与处置建议。',
    'en-US':
      'Risk propagation, alerts and recommendations across suppliers, materials and products.',
  },
  schema: {
    apiName: 'supplyChain',
    displayName: {'zh-CN': '供应链', 'en-US': 'Supply chain'},
    version: '1.0.0',
    objectTypes: [
      {
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
      },
      {
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
      },
      {
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
            displayName: {
              'zh-CN': '安全库存天数',
              'en-US': 'Safety stock days',
            },
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
      },
    ],
    linkTypes: [
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
    ],
    actionTypes: [
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
        displayName: {
          'zh-CN': '提高安全库存',
          'en-US': 'Increase safety stock',
        },
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
          {
            kind: 'increment',
            prop: 'safetyStockDays',
            by: {var: 'params.days'},
          },
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
    ],
    functions: [
      {
        apiName: 'supplierRiskLevel',
        objectType: 'Supplier',
        expr: {
          if: [
            {'>=': [{var: 'riskScore'}, 70]},
            'HIGH',
            {'>=': [{var: 'riskScore'}, 40]},
            'MEDIUM',
            'LOW',
          ],
        },
        returns: 'string',
      },
      {
        apiName: 'coverageDays',
        objectType: 'Product',
        expr: {'-': [{var: 'inventoryDays'}, {var: 'safetyStockDays'}]},
        returns: 'double',
      },
    ],
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
        displayName: {
          'zh-CN': '未受影响产品数',
          'en-US': 'Unaffected products',
        },
        objectType: 'Product',
        agg: 'count',
        higherIsBetter: true,
      },
    ],
  },
  automations: [
    {
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
    },
    {
      name: {'zh-CN': '库存不足', 'en-US': 'Low inventory'},
      trigger: {kind: 'threshold', objectType: 'Product'},
      condition: {op: 'lt', prop: 'inventoryDays', value: 5},
      effects: [{kind: 'alert'}],
      severity: 'MEDIUM',
      cooldownSec: 3600,
      enabled: true,
    },
  ],
  kpis: [
    {
      name: {'zh-CN': '高风险供应商', 'en-US': 'High-risk suppliers'},
      objectSet: {
        objectType: 'Supplier',
        filter: {op: 'gte', prop: 'riskScore', value: 70},
      },
      aggregate: {fn: 'count'},
      target: 0,
      higherIsBetter: false,
    },
    {
      name: {'zh-CN': '平均供应商风险', 'en-US': 'Average supplier risk'},
      objectSet: {objectType: 'Supplier'},
      aggregate: {fn: 'avg', prop: 'riskScore'},
      target: 40,
      higherIsBetter: false,
    },
    {
      name: {'zh-CN': '缺货风险产品', 'en-US': 'Products at risk'},
      objectSet: {
        objectType: 'Product',
        filter: {op: 'lt', prop: 'inventoryDays', value: 7},
      },
      aggregate: {fn: 'count'},
      target: 0,
      higherIsBetter: false,
    },
    {
      name: {'zh-CN': '日需求总量', 'en-US': 'Total daily demand'},
      objectSet: {objectType: 'Product'},
      aggregate: {fn: 'sum', prop: 'dailyDemand'},
      unit: 'units',
      higherIsBetter: true,
    },
  ],
};
