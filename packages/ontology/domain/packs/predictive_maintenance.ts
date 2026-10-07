/**
 * @fileoverview Built-in shared read-only template "工业设备预测性维护"
 * (Industrial Predictive Maintenance). Workspaces reference it until their
 * first ontology change, which copies it (copy-on-write).
 *
 * - Equipment: equipmentId (PK), name, location, healthScore (0..100),
 *   status (running | warning | down), lastMaintenance, overdue.
 * - Sensor: sensorId (PK), equipmentId, type, value, unit, threshold.
 * - MaintenanceRecord: recordId (PK), equipmentId, type, date, technician,
 *   cost.
 * - Links: Sensor → Equipment "mountedOn"; MaintenanceRecord → Equipment
 *   "for".
 */

import type {OntologyDef, TemplateSeeds} from '../../contract';

/** Version of the built-in predictive-maintenance template. */
export const PREDICTIVE_MAINTENANCE_TEMPLATE_VERSION = '1.0.0';

/** Predictive-maintenance template definition. */
export const PREDICTIVE_MAINTENANCE_DEFINITION: OntologyDef = {
  objectTypes: [
    {
      apiName: 'Equipment',
      displayName: {'zh-CN': '设备', 'en-US': 'Equipment'},
      icon: 'cog',
      primaryKey: 'equipmentId',
      titleProperty: 'name',
      properties: [
        {
          apiName: 'equipmentId',
          displayName: {'zh-CN': '设备编号', 'en-US': 'Equipment ID'},
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
          apiName: 'healthScore',
          displayName: {'zh-CN': '健康分', 'en-US': 'Health score'},
          dataType: 'double',
          indexed: true,
          semanticTags: ['health'],
        },
        {
          apiName: 'status',
          displayName: {'zh-CN': '状态', 'en-US': 'Status'},
          dataType: 'enum',
          enumValues: ['running', 'warning', 'down'],
          indexed: true,
        },
        {
          apiName: 'lastMaintenance',
          displayName: {'zh-CN': '上次维护', 'en-US': 'Last maintenance'},
          dataType: 'date',
        },
        {
          apiName: 'overdue',
          displayName: {'zh-CN': '维护逾期', 'en-US': 'Overdue'},
          dataType: 'boolean',
          indexed: true,
        },
      ],
    },
    {
      apiName: 'Sensor',
      displayName: {'zh-CN': '传感器', 'en-US': 'Sensor'},
      icon: 'activity',
      primaryKey: 'sensorId',
      titleProperty: 'type',
      properties: [
        {
          apiName: 'sensorId',
          displayName: {'zh-CN': '传感器编号', 'en-US': 'Sensor ID'},
          dataType: 'string',
          required: true,
        },
        {
          apiName: 'equipmentId',
          displayName: {'zh-CN': '设备编号', 'en-US': 'Equipment ID'},
          dataType: 'string',
          required: true,
          indexed: true,
        },
        {
          apiName: 'type',
          displayName: {'zh-CN': '类型', 'en-US': 'Type'},
          dataType: 'string',
          required: true,
          indexed: true,
        },
        {
          apiName: 'value',
          displayName: {'zh-CN': '当前值', 'en-US': 'Value'},
          dataType: 'double',
          indexed: true,
        },
        {
          apiName: 'unit',
          displayName: {'zh-CN': '单位', 'en-US': 'Unit'},
          dataType: 'string',
        },
        {
          apiName: 'threshold',
          displayName: {'zh-CN': '阈值', 'en-US': 'Threshold'},
          dataType: 'double',
        },
      ],
    },
    {
      apiName: 'MaintenanceRecord',
      displayName: {'zh-CN': '维护记录', 'en-US': 'Maintenance record'},
      icon: 'wrench',
      primaryKey: 'recordId',
      titleProperty: 'type',
      properties: [
        {
          apiName: 'recordId',
          displayName: {'zh-CN': '记录编号', 'en-US': 'Record ID'},
          dataType: 'string',
          required: true,
        },
        {
          apiName: 'equipmentId',
          displayName: {'zh-CN': '设备编号', 'en-US': 'Equipment ID'},
          dataType: 'string',
          required: true,
          indexed: true,
        },
        {
          apiName: 'type',
          displayName: {'zh-CN': '类型', 'en-US': 'Type'},
          dataType: 'string',
          required: true,
          indexed: true,
        },
        {
          apiName: 'date',
          displayName: {'zh-CN': '日期', 'en-US': 'Date'},
          dataType: 'date',
          indexed: true,
        },
        {
          apiName: 'technician',
          displayName: {'zh-CN': '技术员', 'en-US': 'Technician'},
          dataType: 'string',
        },
        {
          apiName: 'cost',
          displayName: {'zh-CN': '费用', 'en-US': 'Cost'},
          dataType: 'double',
          unit: 'CNY',
          indexed: true,
        },
      ],
    },
  ],
  linkTypes: [
    {
      apiName: 'mountedOn',
      displayName: {'zh-CN': '安装于', 'en-US': 'Mounted on'},
      from: 'Sensor',
      to: 'Equipment',
      cardinality: 'many',
      propagation: {defaultWeight: 1},
    },
    {
      apiName: 'for',
      displayName: {'zh-CN': '针对', 'en-US': 'For'},
      from: 'MaintenanceRecord',
      to: 'Equipment',
      cardinality: 'many',
      propagation: {defaultWeight: 1},
    },
  ],
  actionTypes: [
    {
      apiName: 'scheduleMaintenance',
      displayName: {'zh-CN': '安排维护', 'en-US': 'Schedule maintenance'},
      description: {
        'zh-CN': '把设备标记为已安排维护并清除逾期。',
        'en-US': 'Marks equipment as scheduled and clears the overdue flag.',
      },
      targetType: 'Equipment',
      parameters: [],
      preconditions: [],
      effects: [
        {kind: 'set', prop: 'overdue', value: false},
        {kind: 'set', prop: 'status', value: 'warning'},
      ],
      impact: [{property: 'healthScore', change: 0.2}],
    },
    {
      apiName: 'resetHealth',
      displayName: {'zh-CN': '恢复健康', 'en-US': 'Restore health'},
      description: {
        'zh-CN': '维护后将设备健康分恢复到 100。',
        'en-US': 'Restores equipment health score to 100 after maintenance.',
      },
      targetType: 'Equipment',
      parameters: [],
      preconditions: [],
      effects: [
        {kind: 'set', prop: 'healthScore', value: 100},
        {kind: 'set', prop: 'status', value: 'running'},
        {kind: 'set', prop: 'overdue', value: false},
      ],
      impact: [{property: 'healthScore', change: 1}],
    },
  ],
  functions: [
    {
      apiName: 'healthLevel',
      displayName: {'zh-CN': '健康等级', 'en-US': 'Health level'},
      objectType: 'Equipment',
      expr: {
        if: [
          {'>=': [{var: 'healthScore'}, 80]},
          'GOOD',
          {'>=': [{var: 'healthScore'}, 50]},
          'FAIR',
          'POOR',
        ],
      },
      returns: 'string',
    },
  ],
  simulationKpis: [
    {
      apiName: 'avgHealthScore',
      displayName: {'zh-CN': '平均健康分', 'en-US': 'Average health score'},
      objectType: 'Equipment',
      property: 'healthScore',
      agg: 'avg',
      higherIsBetter: true,
    },
    {
      apiName: 'runningEquipment',
      displayName: {'zh-CN': '运行中设备数', 'en-US': 'Running equipment'},
      objectType: 'Equipment',
      agg: 'count',
      higherIsBetter: true,
    },
    {
      apiName: 'maintenanceCost',
      displayName: {'zh-CN': '维护总费用', 'en-US': 'Maintenance cost'},
      objectType: 'MaintenanceRecord',
      property: 'cost',
      agg: 'sum',
      unit: 'CNY',
      higherIsBetter: false,
    },
  ],
};

/** KPI and automation seeds installed by situation-awareness. */
export const PREDICTIVE_MAINTENANCE_SEEDS: TemplateSeeds = {
  kpis: [
    {
      id: 'avgHealthScore',
      name: {'zh-CN': '平均健康分', 'en-US': 'Average health score'},
      objectType: 'Equipment',
      aggregate: {fn: 'avg', prop: 'healthScore'},
      target: 80,
      higherIsBetter: true,
    },
    {
      id: 'downEquipment',
      name: {'zh-CN': '停机设备数', 'en-US': 'Down equipment'},
      objectType: 'Equipment',
      aggregate: {fn: 'count'},
      filter: {op: 'eq', prop: 'status', value: 'down'},
      target: 0,
      higherIsBetter: false,
    },
    {
      id: 'overdueMaintenance',
      name: {'zh-CN': '逾期维护数', 'en-US': 'Overdue maintenance'},
      objectType: 'Equipment',
      aggregate: {fn: 'count'},
      filter: {op: 'eq', prop: 'overdue', value: true},
      target: 0,
      higherIsBetter: false,
    },
    {
      id: 'maintenanceCost',
      name: {'zh-CN': '维护总费用', 'en-US': 'Maintenance cost'},
      objectType: 'MaintenanceRecord',
      aggregate: {fn: 'sum', prop: 'cost'},
      unit: 'CNY',
      higherIsBetter: false,
    },
  ],
  automations: [
    {
      id: 'healthLow',
      name: {'zh-CN': '设备健康度过低', 'en-US': 'Equipment health low'},
      trigger: 'threshold',
      objectType: 'Equipment',
      condition: {op: 'lt', prop: 'healthScore', value: 50},
      severity: 'HIGH',
      cooldownSec: 3600,
      enabled: true,
    },
    {
      id: 'equipmentDown',
      name: {'zh-CN': '设备停机告警', 'en-US': 'Equipment down'},
      trigger: 'threshold',
      objectType: 'Equipment',
      condition: {op: 'eq', prop: 'status', value: 'down'},
      severity: 'CRITICAL',
      cooldownSec: 3600,
      enabled: true,
    },
  ],
};
