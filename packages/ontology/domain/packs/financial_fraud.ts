/**
 * @fileoverview Built-in shared read-only template "金融反欺诈与合规监测"
 * (Financial Anti-Fraud & Compliance). Workspaces reference it until their
 * first ontology change, which copies it (copy-on-write).
 *
 * - Account: accountId (PK), holderName, type (personal | business),
 *   balance, riskScore (0..100), status (active | frozen | closed).
 * - Transaction: txnId (PK), fromAccount, toAccount, amount, currency,
 *   status (pending | completed | failed), flagged.
 * - Customer: customerId (PK), name, email, kycStatus
 *   (verified | pending | rejected).
 * - Links: Transaction → Account "from"; Transaction → Account "to";
 *   Customer → Account "owns".
 */

import type {OntologyDef, TemplateSeeds} from '../../contract';

/** Version of the built-in financial-fraud template. */
export const FINANCIAL_FRAUD_TEMPLATE_VERSION = '1.0.0';

/** Financial-fraud template definition. */
export const FINANCIAL_FRAUD_DEFINITION: OntologyDef = {
  objectTypes: [
    {
      apiName: 'Account',
      displayName: {'zh-CN': '账户', 'en-US': 'Account'},
      icon: 'wallet',
      primaryKey: 'accountId',
      titleProperty: 'holderName',
      properties: [
        {
          apiName: 'accountId',
          displayName: {'zh-CN': '账户编号', 'en-US': 'Account ID'},
          dataType: 'string',
          required: true,
        },
        {
          apiName: 'holderName',
          displayName: {'zh-CN': '持有人', 'en-US': 'Holder name'},
          dataType: 'string',
          required: true,
          indexed: true,
        },
        {
          apiName: 'type',
          displayName: {'zh-CN': '类型', 'en-US': 'Type'},
          dataType: 'enum',
          enumValues: ['personal', 'business'],
          indexed: true,
        },
        {
          apiName: 'balance',
          displayName: {'zh-CN': '余额', 'en-US': 'Balance'},
          dataType: 'double',
          unit: 'CNY',
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
          apiName: 'status',
          displayName: {'zh-CN': '状态', 'en-US': 'Status'},
          dataType: 'enum',
          enumValues: ['active', 'frozen', 'closed'],
          indexed: true,
        },
      ],
    },
    {
      apiName: 'Transaction',
      displayName: {'zh-CN': '交易', 'en-US': 'Transaction'},
      icon: 'transfer',
      primaryKey: 'txnId',
      titleProperty: 'txnId',
      properties: [
        {
          apiName: 'txnId',
          displayName: {'zh-CN': '交易编号', 'en-US': 'Transaction ID'},
          dataType: 'string',
          required: true,
        },
        {
          apiName: 'fromAccount',
          displayName: {'zh-CN': '付款账户', 'en-US': 'From account'},
          dataType: 'string',
          required: true,
          indexed: true,
        },
        {
          apiName: 'toAccount',
          displayName: {'zh-CN': '收款账户', 'en-US': 'To account'},
          dataType: 'string',
          required: true,
          indexed: true,
        },
        {
          apiName: 'amount',
          displayName: {'zh-CN': '金额', 'en-US': 'Amount'},
          dataType: 'double',
          unit: 'CNY',
          required: true,
          indexed: true,
        },
        {
          apiName: 'currency',
          displayName: {'zh-CN': '币种', 'en-US': 'Currency'},
          dataType: 'string',
          indexed: true,
        },
        {
          apiName: 'status',
          displayName: {'zh-CN': '状态', 'en-US': 'Status'},
          dataType: 'enum',
          enumValues: ['pending', 'completed', 'failed'],
          indexed: true,
        },
        {
          apiName: 'flagged',
          displayName: {'zh-CN': '可疑标记', 'en-US': 'Flagged'},
          dataType: 'boolean',
          indexed: true,
        },
      ],
    },
    {
      apiName: 'Customer',
      displayName: {'zh-CN': '客户', 'en-US': 'Customer'},
      icon: 'user',
      primaryKey: 'customerId',
      titleProperty: 'name',
      properties: [
        {
          apiName: 'customerId',
          displayName: {'zh-CN': '客户编号', 'en-US': 'Customer ID'},
          dataType: 'string',
          required: true,
        },
        {
          apiName: 'name',
          displayName: {'zh-CN': '姓名', 'en-US': 'Name'},
          dataType: 'string',
          required: true,
          indexed: true,
        },
        {
          apiName: 'email',
          displayName: {'zh-CN': '邮箱', 'en-US': 'E-mail'},
          dataType: 'string',
          sensitive: true,
        },
        {
          apiName: 'kycStatus',
          displayName: {'zh-CN': 'KYC 状态', 'en-US': 'KYC status'},
          dataType: 'enum',
          enumValues: ['verified', 'pending', 'rejected'],
          indexed: true,
        },
      ],
    },
  ],
  linkTypes: [
    {
      apiName: 'from',
      displayName: {'zh-CN': '付款', 'en-US': 'From'},
      from: 'Transaction',
      to: 'Account',
      cardinality: 'many',
      propagation: {defaultWeight: 1},
    },
    {
      apiName: 'to',
      displayName: {'zh-CN': '收款', 'en-US': 'To'},
      from: 'Transaction',
      to: 'Account',
      cardinality: 'many',
      propagation: {defaultWeight: 1},
    },
    {
      apiName: 'owns',
      displayName: {'zh-CN': '持有', 'en-US': 'Owns'},
      from: 'Customer',
      to: 'Account',
      cardinality: 'many',
      propagation: {defaultWeight: 1},
    },
  ],
  actionTypes: [
    {
      apiName: 'freezeAccount',
      displayName: {'zh-CN': '冻结账户', 'en-US': 'Freeze account'},
      description: {
        'zh-CN': '冻结高风险账户以阻止进一步交易。',
        'en-US': 'Freezes a high-risk account to block further transactions.',
      },
      targetType: 'Account',
      parameters: [],
      preconditions: [
        {
          expr: {'!==': [{var: 'target.status'}, 'closed']},
          message: {
            'zh-CN': '已销户的账户不能冻结',
            'en-US': 'Closed accounts cannot be frozen',
          },
        },
      ],
      effects: [{kind: 'set', prop: 'status', value: 'frozen'}],
      impact: [{property: 'riskScore', change: -0.3}],
    },
    {
      apiName: 'reviewTransaction',
      displayName: {'zh-CN': '审核交易', 'en-US': 'Review transaction'},
      description: {
        'zh-CN': '清除交易的可疑标记。',
        'en-US': 'Clears the suspicious flag on a transaction.',
      },
      targetType: 'Transaction',
      parameters: [],
      preconditions: [
        {
          expr: {'===': [{var: 'target.flagged'}, true]},
          message: {
            'zh-CN': '该交易未被标记',
            'en-US': 'The transaction is not flagged',
          },
        },
      ],
      effects: [{kind: 'set', prop: 'flagged', value: false}],
      impact: [{property: 'amount', change: -0.1}],
    },
  ],
  functions: [
    {
      apiName: 'riskLevel',
      displayName: {'zh-CN': '风险等级', 'en-US': 'Risk level'},
      objectType: 'Account',
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
  ],
  simulationKpis: [
    {
      apiName: 'totalBalance',
      displayName: {'zh-CN': '账户总余额', 'en-US': 'Total balance'},
      objectType: 'Account',
      property: 'balance',
      agg: 'sum',
      unit: 'CNY',
      higherIsBetter: true,
    },
    {
      apiName: 'totalTxnAmount',
      displayName: {'zh-CN': '交易总金额', 'en-US': 'Total transaction amount'},
      objectType: 'Transaction',
      property: 'amount',
      agg: 'sum',
      unit: 'CNY',
      higherIsBetter: true,
    },
    {
      apiName: 'activeAccounts',
      displayName: {'zh-CN': '活跃账户数', 'en-US': 'Active accounts'},
      objectType: 'Account',
      agg: 'count',
      higherIsBetter: true,
    },
  ],
};

/** KPI and automation seeds installed by situation-awareness. */
export const FINANCIAL_FRAUD_SEEDS: TemplateSeeds = {
  kpis: [
    {
      id: 'highRiskAccounts',
      name: {'zh-CN': '高风险账户数', 'en-US': 'High-risk accounts'},
      objectType: 'Account',
      aggregate: {fn: 'count'},
      filter: {op: 'gte', prop: 'riskScore', value: 70},
      target: 0,
      higherIsBetter: false,
    },
    {
      id: 'flaggedTxns',
      name: {'zh-CN': '可疑交易数', 'en-US': 'Flagged transactions'},
      objectType: 'Transaction',
      aggregate: {fn: 'count'},
      filter: {op: 'eq', prop: 'flagged', value: true},
      target: 0,
      higherIsBetter: false,
    },
    {
      id: 'totalTxnAmount',
      name: {'zh-CN': '交易总金额', 'en-US': 'Total transaction amount'},
      objectType: 'Transaction',
      aggregate: {fn: 'sum', prop: 'amount'},
      unit: 'CNY',
      higherIsBetter: true,
    },
    {
      id: 'pendingKyc',
      name: {'zh-CN': '待审核 KYC 数', 'en-US': 'Pending KYC'},
      objectType: 'Customer',
      aggregate: {fn: 'count'},
      filter: {op: 'eq', prop: 'kycStatus', value: 'pending'},
      target: 0,
      higherIsBetter: false,
    },
  ],
  automations: [
    {
      id: 'highRiskAccount',
      name: {'zh-CN': '高风险账户告警', 'en-US': 'High-risk account'},
      trigger: 'threshold',
      objectType: 'Account',
      condition: {op: 'gte', prop: 'riskScore', value: 70},
      severity: 'HIGH',
      cooldownSec: 3600,
      enabled: true,
    },
    {
      id: 'largeTransaction',
      name: {'zh-CN': '大额交易告警', 'en-US': 'Large transaction'},
      trigger: 'threshold',
      objectType: 'Transaction',
      condition: {op: 'gt', prop: 'amount', value: 100000},
      severity: 'MEDIUM',
      cooldownSec: 3600,
      enabled: true,
    },
  ],
};
