/**
 * @fileoverview Built-in shared read-only template "城市态势感知与应急指挥"
 * (Urban Situational Awareness & Emergency Command). Workspaces reference it
 * until their first ontology change, which copies it (copy-on-write).
 *
 * - TrafficNode: trafficNodeId (PK), name, area, congestionLevel (0..100),
 *   status (normal | congested | blocked).
 * - Camera: cameraId (PK), name, location, status (online | offline).
 * - Incident: incidentId (PK), type, severity (LOW | MEDIUM | HIGH | CRITICAL),
 *   status (open | resolved), description.
 * - Links: Camera → TrafficNode "monitors"; Incident → TrafficNode "occursAt".
 */

import type {OntologyDef, TemplateSeeds} from '../../contract';

/** Version of the built-in urban-emergency template. */
export const URBAN_EMERGENCY_TEMPLATE_VERSION = '1.0.0';

/** Urban-emergency template definition. */
export const URBAN_EMERGENCY_DEFINITION: OntologyDef = {
  objectTypes: [
    {
      apiName: 'TrafficNode',
      displayName: {'zh-CN': '交通节点', 'en-US': 'Traffic node'},
      icon: 'route',
      primaryKey: 'trafficNodeId',
      titleProperty: 'name',
      properties: [
        {
          apiName: 'trafficNodeId',
          displayName: {'zh-CN': '节点编号', 'en-US': 'Node ID'},
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
          apiName: 'area',
          displayName: {'zh-CN': '区域', 'en-US': 'Area'},
          dataType: 'string',
          indexed: true,
        },
        {
          apiName: 'congestionLevel',
          displayName: {'zh-CN': '拥堵指数', 'en-US': 'Congestion level'},
          dataType: 'double',
          indexed: true,
          semanticTags: ['risk'],
        },
        {
          apiName: 'status',
          displayName: {'zh-CN': '状态', 'en-US': 'Status'},
          dataType: 'enum',
          enumValues: ['normal', 'congested', 'blocked'],
          indexed: true,
        },
      ],
    },
    {
      apiName: 'Camera',
      displayName: {'zh-CN': '摄像头', 'en-US': 'Camera'},
      icon: 'video',
      primaryKey: 'cameraId',
      titleProperty: 'name',
      properties: [
        {
          apiName: 'cameraId',
          displayName: {'zh-CN': '摄像头编号', 'en-US': 'Camera ID'},
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
          apiName: 'location',
          displayName: {'zh-CN': '位置', 'en-US': 'Location'},
          dataType: 'string',
          indexed: true,
        },
        {
          apiName: 'status',
          displayName: {'zh-CN': '状态', 'en-US': 'Status'},
          dataType: 'enum',
          enumValues: ['online', 'offline'],
          indexed: true,
        },
      ],
    },
    {
      apiName: 'Incident',
      displayName: {'zh-CN': '事件', 'en-US': 'Incident'},
      icon: 'alert',
      primaryKey: 'incidentId',
      titleProperty: 'type',
      properties: [
        {
          apiName: 'incidentId',
          displayName: {'zh-CN': '事件编号', 'en-US': 'Incident ID'},
          dataType: 'string',
          required: true,
        },
        {
          apiName: 'type',
          displayName: {'zh-CN': '类型', 'en-US': 'Type'},
          dataType: 'string',
          required: true,
          indexed: true,
        },
        {
          apiName: 'severity',
          displayName: {'zh-CN': '严重程度', 'en-US': 'Severity'},
          dataType: 'enum',
          enumValues: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
          indexed: true,
          semanticTags: ['risk'],
        },
        {
          apiName: 'status',
          displayName: {'zh-CN': '状态', 'en-US': 'Status'},
          dataType: 'enum',
          enumValues: ['open', 'resolved'],
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
      apiName: 'monitors',
      displayName: {'zh-CN': '监控', 'en-US': 'Monitors'},
      from: 'Camera',
      to: 'TrafficNode',
      cardinality: 'many',
      propagation: {defaultWeight: 1},
    },
    {
      apiName: 'occursAt',
      displayName: {'zh-CN': '发生于', 'en-US': 'Occurs at'},
      from: 'Incident',
      to: 'TrafficNode',
      cardinality: 'many',
      propagation: {defaultWeight: 1},
    },
  ],
  actionTypes: [
    {
      apiName: 'resolveIncident',
      displayName: {'zh-CN': '处置事件', 'en-US': 'Resolve incident'},
      description: {
        'zh-CN': '把事件状态标记为已处置。',
        'en-US': 'Marks an incident as resolved.',
      },
      targetType: 'Incident',
      parameters: [],
      preconditions: [
        {
          expr: {'!==': [{var: 'target.status'}, 'resolved']},
          message: {
            'zh-CN': '该事件已处置',
            'en-US': 'The incident is already resolved',
          },
        },
      ],
      effects: [{kind: 'set', prop: 'status', value: 'resolved'}],
      impact: [{property: 'severity', change: -0.5}],
    },
    {
      apiName: 'restartCamera',
      displayName: {'zh-CN': '重启摄像头', 'en-US': 'Restart camera'},
      description: {
        'zh-CN': '将离线摄像头重新上线。',
        'en-US': 'Brings an offline camera back online.',
      },
      targetType: 'Camera',
      parameters: [],
      preconditions: [
        {
          expr: {'===': [{var: 'target.status'}, 'offline']},
          message: {
            'zh-CN': '摄像头已在线',
            'en-US': 'The camera is already online',
          },
        },
      ],
      effects: [{kind: 'set', prop: 'status', value: 'online'}],
      impact: [{property: 'status', change: 0.5}],
    },
  ],
  functions: [
    {
      apiName: 'congestionLabel',
      displayName: {'zh-CN': '拥堵等级', 'en-US': 'Congestion label'},
      objectType: 'TrafficNode',
      expr: {
        if: [
          {'>=': [{var: 'congestionLevel'}, 70]},
          'HIGH',
          {'>=': [{var: 'congestionLevel'}, 40]},
          'MEDIUM',
          'LOW',
        ],
      },
      returns: 'string',
    },
  ],
  simulationKpis: [
    {
      apiName: 'avgCongestion',
      displayName: {'zh-CN': '平均拥堵指数', 'en-US': 'Average congestion'},
      objectType: 'TrafficNode',
      property: 'congestionLevel',
      agg: 'avg',
      higherIsBetter: false,
    },
    {
      apiName: 'onlineCameras',
      displayName: {'zh-CN': '在线摄像头数', 'en-US': 'Online cameras'},
      objectType: 'Camera',
      agg: 'count',
      higherIsBetter: true,
    },
    {
      apiName: 'openIncidents',
      displayName: {'zh-CN': '未处置事件数', 'en-US': 'Open incidents'},
      objectType: 'Incident',
      agg: 'count',
      higherIsBetter: false,
    },
  ],
};

/** KPI and automation seeds installed by situation-awareness. */
export const URBAN_EMERGENCY_SEEDS: TemplateSeeds = {
  kpis: [
    {
      id: 'congestedNodes',
      name: {'zh-CN': '拥堵节点数', 'en-US': 'Congested nodes'},
      objectType: 'TrafficNode',
      aggregate: {fn: 'count'},
      filter: {op: 'gte', prop: 'congestionLevel', value: 70},
      target: 0,
      higherIsBetter: false,
    },
    {
      id: 'avgCongestion',
      name: {'zh-CN': '平均拥堵指数', 'en-US': 'Average congestion'},
      objectType: 'TrafficNode',
      aggregate: {fn: 'avg', prop: 'congestionLevel'},
      target: 30,
      higherIsBetter: false,
    },
    {
      id: 'offlineCameras',
      name: {'zh-CN': '离线摄像头数', 'en-US': 'Offline cameras'},
      objectType: 'Camera',
      aggregate: {fn: 'count'},
      filter: {op: 'eq', prop: 'status', value: 'offline'},
      target: 0,
      higherIsBetter: false,
    },
    {
      id: 'criticalIncidents',
      name: {'zh-CN': '紧急事件数', 'en-US': 'Critical incidents'},
      objectType: 'Incident',
      aggregate: {fn: 'count'},
      filter: {op: 'eq', prop: 'severity', value: 'CRITICAL'},
      target: 0,
      higherIsBetter: false,
    },
  ],
  automations: [
    {
      id: 'congestionHigh',
      name: {'zh-CN': '节点拥堵告警', 'en-US': 'Node congestion high'},
      trigger: 'threshold',
      objectType: 'TrafficNode',
      condition: {op: 'gte', prop: 'congestionLevel', value: 70},
      severity: 'HIGH',
      cooldownSec: 3600,
      enabled: true,
    },
    {
      id: 'incidentCritical',
      name: {'zh-CN': '紧急事件告警', 'en-US': 'Critical incident'},
      trigger: 'threshold',
      objectType: 'Incident',
      condition: {op: 'eq', prop: 'severity', value: 'CRITICAL'},
      severity: 'CRITICAL',
      cooldownSec: 3600,
      enabled: true,
    },
  ],
};
