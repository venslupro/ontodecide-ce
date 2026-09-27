/**
 * @fileoverview Built-in shared read-only template "supply chain risk"
 * (详细设计 6.11.1). Workspaces reference it until their first ontology
 * change, which copies it (copy-on-write).
 *
 * Property names are a contract with the sample data owned by
 * data-integration (80 objects / 160 links) and with the seeds below; keep
 * them stable:
 *
 * - Supplier: supplierId (PK), name, country (ISO 3166 alpha-2),
 *   riskScore (0..100), capacity (units/day), onTimeRate (fraction 0..1),
 *   status (active | watch | suspended), contactEmail (sensitive).
 * - Material: materialId (PK), name, category, stock (units),
 *   safetyStock (units), unitCost, leadTimeDays.
 * - Product: productId (PK), name, category, revenue (per day),
 *   dailyDemand (units/day), status (active | atRisk | discontinued).
 * - Links: Supplier → Material "supplies" (link weight = supply share
 *   0..1); Material → Product "usedIn" (weight = bill-of-material share).
 */

import type {OntologyDef, TemplateSeeds} from '../../contract';

/** Version of the built-in supply-chain template. */
export const SUPPLY_CHAIN_TEMPLATE_VERSION = '1.0.0';

/** Supply-chain template definition. */
export const SUPPLY_CHAIN_DEFINITION: OntologyDef = {
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
          displayName: {'zh-CN': '国家/地区', 'en-US': 'Country'},
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
          displayName: {'zh-CN': '准时交付率', 'en-US': 'On-time rate'},
          dataType: 'double',
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
      icon: 'package',
      primaryKey: 'materialId',
      titleProperty: 'name',
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
          apiName: 'stock',
          displayName: {'zh-CN': '库存', 'en-US': 'Stock'},
          dataType: 'double',
          unit: 'units',
          indexed: true,
        },
        {
          apiName: 'safetyStock',
          displayName: {'zh-CN': '安全库存', 'en-US': 'Safety stock'},
          dataType: 'double',
          unit: 'units',
          indexed: true,
        },
        {
          apiName: 'unitCost',
          displayName: {'zh-CN': '单价', 'en-US': 'Unit cost'},
          dataType: 'double',
          unit: 'CNY',
        },
        {
          apiName: 'leadTimeDays',
          displayName: {'zh-CN': '采购周期', 'en-US': 'Lead time'},
          dataType: 'integer',
          unit: 'd',
        },
      ],
    },
    {
      apiName: 'Product',
      displayName: {'zh-CN': '产品', 'en-US': 'Product'},
      icon: 'box',
      primaryKey: 'productId',
      titleProperty: 'name',
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
          apiName: 'category',
          displayName: {'zh-CN': '类别', 'en-US': 'Category'},
          dataType: 'string',
          indexed: true,
        },
        {
          apiName: 'revenue',
          displayName: {'zh-CN': '日收入', 'en-US': 'Daily revenue'},
          dataType: 'double',
          unit: 'CNY',
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
          apiName: 'status',
          displayName: {'zh-CN': '状态', 'en-US': 'Status'},
          dataType: 'enum',
          enumValues: ['active', 'atRisk', 'discontinued'],
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
      description: {
        'zh-CN': '把物料的供应关系切换到风险更低的备选供应商。',
        'en-US': 'Moves the supply of a material to a lower-risk supplier.',
      },
      targetType: 'Material',
      parameters: [
        {
          apiName: 'newSupplier',
          displayName: {'zh-CN': '新供应商', 'en-US': 'New supplier'},
          dataType: 'objectRef:Supplier',
          required: true,
          // Deterministic candidate: the lowest-risk active supplier that
          // already supplies the same material.
          suggest: {
            objectType: 'Supplier',
            filter: {
              op: 'and',
              args: [
                {op: 'eq', prop: 'status', value: 'active'},
                {op: 'lt', prop: 'riskScore', value: 70},
              ],
            },
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
      // Restores the upstream supply capacity lost by the perturbation.
      impact: [{property: 'capacity', change: 0.5}],
    },
    {
      apiName: 'adjustSafetyStock',
      displayName: {'zh-CN': '调整安全库存', 'en-US': 'Adjust safety stock'},
      description: {
        'zh-CN': '按比例提高物料的安全库存。',
        'en-US': 'Raises the safety stock of a material by a percentage.',
      },
      targetType: 'Material',
      parameters: [
        {
          apiName: 'percent',
          displayName: {'zh-CN': '提高比例（%）', 'en-US': 'Increase (%)'},
          dataType: 'integer',
          required: true,
          defaultValue: 20,
        },
      ],
      preconditions: [
        {
          expr: {
            and: [
              {'>': [{var: 'params.percent'}, 0]},
              {'<=': [{var: 'params.percent'}, 100]},
            ],
          },
          message: {
            'zh-CN': '提高比例须在 1–100 之间',
            'en-US': 'The increase must be between 1 and 100 percent',
          },
        },
      ],
      effects: [
        {
          kind: 'set',
          prop: 'safetyStock',
          value: {
            round: [
              {
                '*': [
                  {var: ['target.safetyStock', 0]},
                  {'+': [1, {'/': [{var: 'params.percent'}, 100]}]},
                ],
              },
            ],
          },
        },
      ],
      impact: [{property: 'stock', change: 0.2}],
    },
    {
      apiName: 'flagSupplier',
      displayName: {'zh-CN': '标记观察', 'en-US': 'Flag supplier'},
      description: {
        'zh-CN': '把供应商标记为观察状态。',
        'en-US': 'Puts a supplier on the watch list.',
      },
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
      impact: [{property: 'riskScore', change: -0.1}],
    },
  ],
  functions: [
    {
      apiName: 'supplierRiskLevel',
      displayName: {'zh-CN': '风险等级', 'en-US': 'Risk level'},
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
      apiName: 'stockCoverage',
      displayName: {'zh-CN': '库存覆盖率', 'en-US': 'Stock coverage'},
      objectType: 'Material',
      expr: {'/': [{var: 'stock'}, {var: 'safetyStock'}]},
      returns: 'double',
    },
  ],
  simulationKpis: [
    {
      apiName: 'revenue',
      displayName: {'zh-CN': '可实现日收入', 'en-US': 'Achievable revenue'},
      objectType: 'Product',
      property: 'revenue',
      agg: 'sum',
      unit: 'CNY',
      higherIsBetter: true,
    },
    {
      apiName: 'supplyCapacity',
      displayName: {'zh-CN': '供应产能', 'en-US': 'Supply capacity'},
      objectType: 'Supplier',
      property: 'capacity',
      agg: 'sum',
      unit: 'units/day',
      higherIsBetter: true,
    },
    {
      apiName: 'avgStock',
      displayName: {'zh-CN': '平均库存', 'en-US': 'Average stock'},
      objectType: 'Material',
      property: 'stock',
      agg: 'avg',
      unit: 'units',
      higherIsBetter: true,
    },
  ],
};

/** KPI and automation seeds installed by situation-awareness. */
export const SUPPLY_CHAIN_SEEDS: TemplateSeeds = {
  kpis: [
    {
      id: 'highRiskSuppliers',
      name: {'zh-CN': '高风险供应商', 'en-US': 'High-risk suppliers'},
      objectType: 'Supplier',
      aggregate: {fn: 'count'},
      filter: {op: 'gte', prop: 'riskScore', value: 70},
      target: 0,
      higherIsBetter: false,
    },
    {
      id: 'avgRiskScore',
      name: {'zh-CN': '平均风险分', 'en-US': 'Average risk score'},
      objectType: 'Supplier',
      aggregate: {fn: 'avg', prop: 'riskScore'},
      target: 40,
      higherIsBetter: false,
    },
    {
      id: 'avgOnTimeRate',
      name: {'zh-CN': '平均准时交付率', 'en-US': 'Average on-time rate'},
      objectType: 'Supplier',
      aggregate: {fn: 'avg', prop: 'onTimeRate'},
      target: 0.95,
      higherIsBetter: true,
    },
    {
      id: 'totalRevenue',
      name: {'zh-CN': '产品日收入', 'en-US': 'Daily product revenue'},
      objectType: 'Product',
      aggregate: {fn: 'sum', prop: 'revenue'},
      unit: 'CNY',
      higherIsBetter: true,
    },
  ],
  automations: [
    {
      id: 'supplierRiskHigh',
      name: {'zh-CN': '供应商风险过高', 'en-US': 'Supplier risk high'},
      trigger: 'threshold',
      objectType: 'Supplier',
      condition: {op: 'gte', prop: 'riskScore', value: 70},
      severity: 'HIGH',
      cooldownSec: 3600,
      enabled: true,
    },
    {
      id: 'onTimeRateReview',
      name: {'zh-CN': '准时率每日巡检', 'en-US': 'Daily on-time review'},
      trigger: 'schedule',
      objectType: 'Supplier',
      condition: {op: 'lt', prop: 'onTimeRate', value: 0.8},
      everyHours: 24,
      severity: 'MEDIUM',
      cooldownSec: 86_400,
      enabled: true,
    },
  ],
};
