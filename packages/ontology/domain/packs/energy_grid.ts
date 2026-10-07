/**
 * @fileoverview Built-in shared read-only template "能源电网运行优化"
 * (Energy Grid Operation Optimization). Workspaces reference it until their
 * first ontology change, which copies it (copy-on-write).
 *
 * - PowerPlant: plantId (PK), name, type (solar | wind | coal | gas | nuclear),
 *   capacity (MW), output (MW), status (online | offline | maintenance).
 * - Substation: substationId (PK), name, voltageKV, load (MW), capacity (MW),
 *   status (normal | warning | emergency), loadRatio.
 * - TransmissionLine: lineId (PK), fromSubstation, toSubstation, current (MW),
 *   capacity (MW), status (normal | overloaded | down).
 * - Links: PowerPlant → Substation "feeds"; Substation → Substation
 *   "connects" (via TransmissionLine).
 */

import type {OntologyDef, TemplateSeeds} from '../../contract';

/** Version of the built-in energy-grid template. */
export const ENERGY_GRID_TEMPLATE_VERSION = '1.0.0';

/** Energy-grid template definition. */
export const ENERGY_GRID_DEFINITION: OntologyDef = {
  objectTypes: [
    {
      apiName: 'PowerPlant',
      displayName: {'zh-CN': '发电厂', 'en-US': 'Power plant'},
      icon: 'zap',
      primaryKey: 'plantId',
      titleProperty: 'name',
      properties: [
        {
          apiName: 'plantId',
          displayName: {'zh-CN': '电厂编号', 'en-US': 'Plant ID'},
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
          enumValues: ['solar', 'wind', 'coal', 'gas', 'nuclear'],
          indexed: true,
        },
        {
          apiName: 'capacity',
          displayName: {'zh-CN': '装机容量', 'en-US': 'Capacity'},
          dataType: 'double',
          unit: 'MW',
          indexed: true,
        },
        {
          apiName: 'output',
          displayName: {'zh-CN': '当前出力', 'en-US': 'Output'},
          dataType: 'double',
          unit: 'MW',
          indexed: true,
        },
        {
          apiName: 'status',
          displayName: {'zh-CN': '状态', 'en-US': 'Status'},
          dataType: 'enum',
          enumValues: ['online', 'offline', 'maintenance'],
          indexed: true,
        },
      ],
    },
    {
      apiName: 'Substation',
      displayName: {'zh-CN': '变电站', 'en-US': 'Substation'},
      icon: 'grid',
      primaryKey: 'substationId',
      titleProperty: 'name',
      properties: [
        {
          apiName: 'substationId',
          displayName: {'zh-CN': '变电站编号', 'en-US': 'Substation ID'},
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
          apiName: 'voltageKV',
          displayName: {'zh-CN': '电压等级', 'en-US': 'Voltage'},
          dataType: 'double',
          unit: 'kV',
          indexed: true,
        },
        {
          apiName: 'load',
          displayName: {'zh-CN': '负载', 'en-US': 'Load'},
          dataType: 'double',
          unit: 'MW',
          indexed: true,
        },
        {
          apiName: 'capacity',
          displayName: {'zh-CN': '容量', 'en-US': 'Capacity'},
          dataType: 'double',
          unit: 'MW',
          indexed: true,
        },
        {
          apiName: 'loadRatio',
          displayName: {'zh-CN': '负载率', 'en-US': 'Load ratio'},
          dataType: 'double',
          indexed: true,
        },
        {
          apiName: 'status',
          displayName: {'zh-CN': '状态', 'en-US': 'Status'},
          dataType: 'enum',
          enumValues: ['normal', 'warning', 'emergency'],
          indexed: true,
        },
      ],
    },
    {
      apiName: 'TransmissionLine',
      displayName: {'zh-CN': '输电线路', 'en-US': 'Transmission line'},
      icon: 'link',
      primaryKey: 'lineId',
      titleProperty: 'lineId',
      properties: [
        {
          apiName: 'lineId',
          displayName: {'zh-CN': '线路编号', 'en-US': 'Line ID'},
          dataType: 'string',
          required: true,
        },
        {
          apiName: 'fromSubstation',
          displayName: {'zh-CN': '起始变电站', 'en-US': 'From substation'},
          dataType: 'string',
          required: true,
          indexed: true,
        },
        {
          apiName: 'toSubstation',
          displayName: {'zh-CN': '目标变电站', 'en-US': 'To substation'},
          dataType: 'string',
          required: true,
          indexed: true,
        },
        {
          apiName: 'current',
          displayName: {'zh-CN': '当前潮流', 'en-US': 'Current'},
          dataType: 'double',
          unit: 'MW',
          indexed: true,
        },
        {
          apiName: 'capacity',
          displayName: {'zh-CN': '容量', 'en-US': 'Capacity'},
          dataType: 'double',
          unit: 'MW',
          indexed: true,
        },
        {
          apiName: 'status',
          displayName: {'zh-CN': '状态', 'en-US': 'Status'},
          dataType: 'enum',
          enumValues: ['normal', 'overloaded', 'down'],
          indexed: true,
        },
      ],
    },
  ],
  linkTypes: [
    {
      apiName: 'feeds',
      displayName: {'zh-CN': '馈入', 'en-US': 'Feeds'},
      from: 'PowerPlant',
      to: 'Substation',
      cardinality: 'many',
      propagation: {defaultWeight: 1},
    },
    {
      apiName: 'connects',
      displayName: {'zh-CN': '连接', 'en-US': 'Connects'},
      from: 'Substation',
      to: 'Substation',
      cardinality: 'many',
      propagation: {defaultWeight: 1},
    },
  ],
  actionTypes: [
    {
      apiName: 'startPlant',
      displayName: {'zh-CN': '启运电厂', 'en-US': 'Start plant'},
      description: {
        'zh-CN': '将离线电厂投入运行。',
        'en-US': 'Brings an offline power plant online.',
      },
      targetType: 'PowerPlant',
      parameters: [],
      preconditions: [
        {
          expr: {'===': [{var: 'target.status'}, 'offline']},
          message: {
            'zh-CN': '电厂非离线状态',
            'en-US': 'The plant is not offline',
          },
        },
      ],
      effects: [{kind: 'set', prop: 'status', value: 'online'}],
      impact: [{property: 'output', change: 0.8}],
    },
    {
      apiName: 'shedLoad',
      displayName: {'zh-CN': '削减负载', 'en-US': 'Shed load'},
      description: {
        'zh-CN': '降低变电站负载以缓解过载。',
        'en-US': 'Reduces substation load to relieve overload.',
      },
      targetType: 'Substation',
      parameters: [
        {
          apiName: 'percent',
          displayName: {'zh-CN': '削减比例（%）', 'en-US': 'Reduction (%)'},
          dataType: 'integer',
          required: true,
          defaultValue: 10,
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
            'zh-CN': '削减比例须在 1–100 之间',
            'en-US': 'The reduction must be between 1 and 100 percent',
          },
        },
      ],
      effects: [
        {
          kind: 'set',
          prop: 'load',
          value: {
            round: [
              {
                '*': [
                  {var: ['target.load', 0]},
                  {'-': [1, {'/': [{var: 'params.percent'}, 100]}]},
                ],
              },
            ],
          },
        },
      ],
      impact: [{property: 'load', change: -0.1}],
    },
  ],
  functions: [
    {
      apiName: 'plantUtilization',
      displayName: {'zh-CN': '电厂利用率', 'en-US': 'Plant utilization'},
      objectType: 'PowerPlant',
      expr: {'/': [{var: 'output'}, {var: 'capacity'}]},
      returns: 'double',
    },
  ],
  simulationKpis: [
    {
      apiName: 'totalOutput',
      displayName: {'zh-CN': '总出力', 'en-US': 'Total output'},
      objectType: 'PowerPlant',
      property: 'output',
      agg: 'sum',
      unit: 'MW',
      higherIsBetter: true,
    },
    {
      apiName: 'avgLoadRatio',
      displayName: {'zh-CN': '平均负载率', 'en-US': 'Average load ratio'},
      objectType: 'Substation',
      property: 'loadRatio',
      agg: 'avg',
      higherIsBetter: false,
    },
    {
      apiName: 'onlinePlants',
      displayName: {'zh-CN': '在线电厂数', 'en-US': 'Online plants'},
      objectType: 'PowerPlant',
      agg: 'count',
      higherIsBetter: true,
    },
  ],
};

/** KPI and automation seeds installed by situation-awareness. */
export const ENERGY_GRID_SEEDS: TemplateSeeds = {
  kpis: [
    {
      id: 'totalOutput',
      name: {'zh-CN': '总出力', 'en-US': 'Total output'},
      objectType: 'PowerPlant',
      aggregate: {fn: 'sum', prop: 'output'},
      unit: 'MW',
      higherIsBetter: true,
    },
    {
      id: 'overloadedLines',
      name: {'zh-CN': '过载线路数', 'en-US': 'Overloaded lines'},
      objectType: 'TransmissionLine',
      aggregate: {fn: 'count'},
      filter: {op: 'eq', prop: 'status', value: 'overloaded'},
      target: 0,
      higherIsBetter: false,
    },
    {
      id: 'offlinePlants',
      name: {'zh-CN': '离线电厂数', 'en-US': 'Offline plants'},
      objectType: 'PowerPlant',
      aggregate: {fn: 'count'},
      filter: {op: 'eq', prop: 'status', value: 'offline'},
      target: 0,
      higherIsBetter: false,
    },
    {
      id: 'avgLoadRatio',
      name: {'zh-CN': '平均负载率', 'en-US': 'Average load ratio'},
      objectType: 'Substation',
      aggregate: {fn: 'avg', prop: 'loadRatio'},
      target: 0.7,
      higherIsBetter: false,
    },
  ],
  automations: [
    {
      id: 'lineOverloaded',
      name: {'zh-CN': '线路过载告警', 'en-US': 'Line overloaded'},
      trigger: 'threshold',
      objectType: 'TransmissionLine',
      condition: {op: 'eq', prop: 'status', value: 'overloaded'},
      severity: 'CRITICAL',
      cooldownSec: 3600,
      enabled: true,
    },
    {
      id: 'plantOffline',
      name: {'zh-CN': '电厂离线告警', 'en-US': 'Plant offline'},
      trigger: 'threshold',
      objectType: 'PowerPlant',
      condition: {op: 'eq', prop: 'status', value: 'offline'},
      severity: 'HIGH',
      cooldownSec: 3600,
      enabled: true,
    },
  ],
};
