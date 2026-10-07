/**
 * @fileoverview Built-in shared read-only template "多源情报融合分析"
 * (Multi-source Intelligence Fusion). Workspaces reference it until their
 * first ontology change, which copies it (copy-on-write).
 *
 * - IntelligenceReport: reportId (PK), title, source, confidence (0..1),
 *   classification (open | confidential | secret), createdAt.
 * - Entity: entityId (PK), name, type (person | organization | location |
 *   event), riskLevel (0..100).
 * - Relationship: relationshipId (PK), type (associatedWith | locatedAt |
 *   partOf), confidence (0..1), description.
 * - Links: IntelligenceReport → Entity "mentions"; Entity → Entity
 *   "relatedTo" (via Relationship).
 */

import type {OntologyDef, TemplateSeeds} from '../../contract';

/** Version of the built-in intelligence-fusion template. */
export const INTELLIGENCE_FUSION_TEMPLATE_VERSION = '1.0.0';

/** Intelligence-fusion template definition. */
export const INTELLIGENCE_FUSION_DEFINITION: OntologyDef = {
  objectTypes: [
    {
      apiName: 'IntelligenceReport',
      displayName: {'zh-CN': '情报报告', 'en-US': 'Intelligence report'},
      icon: 'file-text',
      primaryKey: 'reportId',
      titleProperty: 'title',
      properties: [
        {
          apiName: 'reportId',
          displayName: {'zh-CN': '报告编号', 'en-US': 'Report ID'},
          dataType: 'string',
          required: true,
        },
        {
          apiName: 'title',
          displayName: {'zh-CN': '标题', 'en-US': 'Title'},
          dataType: 'string',
          required: true,
          indexed: true,
        },
        {
          apiName: 'source',
          displayName: {'zh-CN': '来源', 'en-US': 'Source'},
          dataType: 'string',
          indexed: true,
        },
        {
          apiName: 'confidence',
          displayName: {'zh-CN': '置信度', 'en-US': 'Confidence'},
          dataType: 'double',
          indexed: true,
        },
        {
          apiName: 'classification',
          displayName: {'zh-CN': '密级', 'en-US': 'Classification'},
          dataType: 'enum',
          enumValues: ['open', 'confidential', 'secret'],
          indexed: true,
        },
        {
          apiName: 'createdAt',
          displayName: {'zh-CN': '创建时间', 'en-US': 'Created at'},
          dataType: 'timestamp',
          indexed: true,
        },
      ],
    },
    {
      apiName: 'Entity',
      displayName: {'zh-CN': '实体', 'en-US': 'Entity'},
      icon: 'users',
      primaryKey: 'entityId',
      titleProperty: 'name',
      properties: [
        {
          apiName: 'entityId',
          displayName: {'zh-CN': '实体编号', 'en-US': 'Entity ID'},
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
          apiName: 'type',
          displayName: {'zh-CN': '类型', 'en-US': 'Type'},
          dataType: 'enum',
          enumValues: ['person', 'organization', 'location', 'event'],
          indexed: true,
        },
        {
          apiName: 'riskLevel',
          displayName: {'zh-CN': '风险等级', 'en-US': 'Risk level'},
          dataType: 'double',
          indexed: true,
          semanticTags: ['risk'],
        },
      ],
    },
    {
      apiName: 'Relationship',
      displayName: {'zh-CN': '关系', 'en-US': 'Relationship'},
      icon: 'git-branch',
      primaryKey: 'relationshipId',
      titleProperty: 'type',
      properties: [
        {
          apiName: 'relationshipId',
          displayName: {'zh-CN': '关系编号', 'en-US': 'Relationship ID'},
          dataType: 'string',
          required: true,
        },
        {
          apiName: 'type',
          displayName: {'zh-CN': '类型', 'en-US': 'Type'},
          dataType: 'enum',
          enumValues: ['associatedWith', 'locatedAt', 'partOf'],
          required: true,
          indexed: true,
        },
        {
          apiName: 'confidence',
          displayName: {'zh-CN': '置信度', 'en-US': 'Confidence'},
          dataType: 'double',
          indexed: true,
        },
        {
          apiName: 'description',
          displayName: {'zh-CN': '描述', 'en-US': 'Description'},
          dataType: 'string',
        },
      ],
    },
  ],
  linkTypes: [
    {
      apiName: 'mentions',
      displayName: {'zh-CN': '提及', 'en-US': 'Mentions'},
      from: 'IntelligenceReport',
      to: 'Entity',
      cardinality: 'many',
      propagation: {defaultWeight: 1},
    },
    {
      apiName: 'relatedTo',
      displayName: {'zh-CN': '关联', 'en-US': 'Related to'},
      from: 'Entity',
      to: 'Entity',
      cardinality: 'many',
      propagation: {defaultWeight: 1},
    },
  ],
  actionTypes: [
    {
      apiName: 'classifyReport',
      displayName: {'zh-CN': '调整密级', 'en-US': 'Classify report'},
      description: {
        'zh-CN': '提升情报报告的密级。',
        'en-US': 'Raises the classification of an intelligence report.',
      },
      targetType: 'IntelligenceReport',
      parameters: [
        {
          apiName: 'classification',
          displayName: {'zh-CN': '密级', 'en-US': 'Classification'},
          dataType: 'string',
          required: true,
          defaultValue: 'confidential',
        },
      ],
      preconditions: [],
      effects: [
        {
          kind: 'set',
          prop: 'classification',
          value: {var: 'params.classification'},
        },
      ],
      impact: [{property: 'confidence', change: 0.1}],
    },
    {
      apiName: 'flagEntity',
      displayName: {
        'zh-CN': '标记高风险实体',
        'en-US': 'Flag high-risk entity',
      },
      description: {
        'zh-CN': '把实体的风险等级提升到最高。',
        'en-US': 'Raises an entity risk level to the maximum.',
      },
      targetType: 'Entity',
      parameters: [],
      preconditions: [],
      effects: [{kind: 'set', prop: 'riskLevel', value: 100}],
      impact: [{property: 'riskLevel', change: 0.5}],
    },
  ],
  functions: [
    {
      apiName: 'riskLabel',
      displayName: {'zh-CN': '风险标签', 'en-US': 'Risk label'},
      objectType: 'Entity',
      expr: {
        if: [
          {'>=': [{var: 'riskLevel'}, 70]},
          'HIGH',
          {'>=': [{var: 'riskLevel'}, 40]},
          'MEDIUM',
          'LOW',
        ],
      },
      returns: 'string',
    },
  ],
  simulationKpis: [
    {
      apiName: 'avgConfidence',
      displayName: {'zh-CN': '平均置信度', 'en-US': 'Average confidence'},
      objectType: 'IntelligenceReport',
      property: 'confidence',
      agg: 'avg',
      higherIsBetter: true,
    },
    {
      apiName: 'entityCount',
      displayName: {'zh-CN': '实体总数', 'en-US': 'Entity count'},
      objectType: 'Entity',
      agg: 'count',
      higherIsBetter: true,
    },
    {
      apiName: 'avgRiskLevel',
      displayName: {'zh-CN': '平均风险等级', 'en-US': 'Average risk level'},
      objectType: 'Entity',
      property: 'riskLevel',
      agg: 'avg',
      higherIsBetter: false,
    },
  ],
};

/** KPI and automation seeds installed by situation-awareness. */
export const INTELLIGENCE_FUSION_SEEDS: TemplateSeeds = {
  kpis: [
    {
      id: 'highRiskEntities',
      name: {'zh-CN': '高风险实体数', 'en-US': 'High-risk entities'},
      objectType: 'Entity',
      aggregate: {fn: 'count'},
      filter: {op: 'gte', prop: 'riskLevel', value: 70},
      target: 0,
      higherIsBetter: false,
    },
    {
      id: 'avgConfidence',
      name: {'zh-CN': '平均置信度', 'en-US': 'Average confidence'},
      objectType: 'IntelligenceReport',
      aggregate: {fn: 'avg', prop: 'confidence'},
      target: 0.7,
      higherIsBetter: true,
    },
    {
      id: 'newReports',
      name: {'zh-CN': '新增情报数', 'en-US': 'New reports'},
      objectType: 'IntelligenceReport',
      aggregate: {fn: 'count'},
      higherIsBetter: true,
    },
    {
      id: 'unverifiedReports',
      name: {'zh-CN': '未核实情报数', 'en-US': 'Unverified reports'},
      objectType: 'IntelligenceReport',
      aggregate: {fn: 'count'},
      filter: {op: 'lt', prop: 'confidence', value: 0.3},
      target: 0,
      higherIsBetter: false,
    },
  ],
  automations: [
    {
      id: 'highRiskEntity',
      name: {'zh-CN': '高风险实体告警', 'en-US': 'High-risk entity'},
      trigger: 'threshold',
      objectType: 'Entity',
      condition: {op: 'gte', prop: 'riskLevel', value: 70},
      severity: 'HIGH',
      cooldownSec: 3600,
      enabled: true,
    },
    {
      id: 'lowConfidenceReport',
      name: {'zh-CN': '低置信度情报告警', 'en-US': 'Low confidence report'},
      trigger: 'threshold',
      objectType: 'IntelligenceReport',
      condition: {op: 'lt', prop: 'confidence', value: 0.3},
      severity: 'MEDIUM',
      cooldownSec: 3600,
      enabled: true,
    },
  ],
};
