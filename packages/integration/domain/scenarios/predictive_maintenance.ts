/**
 * @fileoverview Predictive-maintenance sample scenario (33 objects, 23 links):
 * 10 Equipment, 15 Sensor (mountedOn), 8 MaintenanceRecord (for). Includes
 * low-health-score and down-status equipment for demo alerts.
 */

import type {Row, SampleDataset} from '../../contract';

const pad = (n: number) => String(n).padStart(3, '0');
const eq = (i: number) => `EQ-${pad(i + 1)}`;
const sen = (i: number) => `SEN-${pad(i + 1)}`;
const mr = (i: number) => `MR-${pad(i + 1)}`;

const EQUIPMENT: [string, string, number, string, string, boolean][] = [
  ['CNC Lathe A1', 'Workshop 1', 92, 'running', '2026-09-15', false],
  ['Hydraulic Press B2', 'Workshop 1', 64, 'warning', '2026-08-20', true],
  ['Conveyor Line C3', 'Workshop 2', 88, 'running', '2026-09-28', false],
  ['Injection Mold D4', 'Workshop 2', 38, 'down', '2026-06-10', true],
  ['Welding Robot E5', 'Workshop 3', 77, 'running', '2026-09-01', false],
  ['Air Compressor F6', 'Workshop 3', 51, 'warning', '2026-07-22', true],
  ['Cooling Tower G7', 'Utilities', 95, 'running', '2026-09-30', false],
  ['Packaging Machine H8', 'Workshop 4', 43, 'warning', '2026-08-05', true],
  ['Boiler I9', 'Utilities', 29, 'down', '2026-05-18', true],
  ['AGV Fleet J10', 'Warehouse', 81, 'running', '2026-09-12', false],
];

/** 10 equipment units. */
function equipmentRows(): Row[] {
  return EQUIPMENT.map(
    ([name, location, health, status, last, overdue], i) => ({
      equipmentId: eq(i),
      name,
      location,
      healthScore: health,
      status,
      lastMaintenance: last,
      overdue,
    }),
  );
}

const SENSOR_TYPES: [string, string, number][] = [
  ['vibration', 'mm/s', 5.0],
  ['temperature', 'C', 80],
  ['pressure', 'MPa', 10],
  ['current', 'A', 50],
  ['flow', 'L/min', 200],
];

/** 15 sensors distributed across equipment (some threshold-exceeding). */
function sensorRows(): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < 15; i++) {
    const t = SENSOR_TYPES[i % SENSOR_TYPES.length];
    const equipmentIndex = i % 10;
    const exceed = i === 3 || i === 8 || i === 12; // anomalous readings
    const base = (i * 7) % 100;
    rows.push({
      sensorId: sen(i),
      equipmentId: eq(equipmentIndex),
      type: t[0],
      value: exceed ? t[2] * 1.8 : base,
      unit: t[1],
      threshold: t[2],
    });
  }
  return rows;
}

const RECORDS: [number, string, string, string, number][] = [
  [0, 'preventive', '2026-09-15', 'Wang Wei', 3200],
  [1, 'corrective', '2026-08-20', 'Li Ming', 8500],
  [2, 'preventive', '2026-09-28', 'Zhang Jun', 2100],
  [3, 'emergency', '2026-06-10', 'Chen Hua', 42000],
  [4, 'preventive', '2026-09-01', 'Liu Fang', 1800],
  [5, 'corrective', '2026-07-22', 'Wang Wei', 6700],
  [6, 'preventive', '2026-09-30', 'Zhao Lei', 950],
  [8, 'emergency', '2026-05-18', 'Chen Hua', 38500],
];

/** 8 maintenance records. */
function maintenanceRecordRows(): Row[] {
  return RECORDS.map(([eqIdx, type, date, technician, cost], i) => ({
    recordId: mr(i),
    equipmentId: eq(eqIdx),
    type,
    date,
    technician,
    cost,
  }));
}

export function predictiveMaintenanceDatasets(): SampleDataset[] {
  return [
    {
      file: 'equipment.csv',
      rows: equipmentRows(),
      mapping: {
        targetType: 'Equipment',
        primaryKey: {from: 'equipmentId', transform: 'trim'},
        fields: [
          {to: 'equipmentId', from: 'equipmentId', transform: 'trim'},
          {to: 'name', from: 'name', transform: 'trim'},
          {to: 'location', from: 'location', transform: 'trim'},
          {to: 'healthScore', from: 'healthScore', transform: 'trim|toNumber'},
          {to: 'status', from: 'status', transform: 'trim|lower'},
          {
            to: 'lastMaintenance',
            from: 'lastMaintenance',
            transform: 'trim|parseDate',
          },
          {to: 'overdue', from: 'overdue', transform: 'trim|toBoolean'},
        ],
      },
    },
    {
      file: 'sensors.csv',
      rows: sensorRows(),
      mapping: {
        targetType: 'Sensor',
        primaryKey: {from: 'sensorId', transform: 'trim'},
        fields: [
          {to: 'sensorId', from: 'sensorId', transform: 'trim'},
          {to: 'equipmentId', from: 'equipmentId', transform: 'trim'},
          {to: 'type', from: 'type', transform: 'trim'},
          {to: 'value', from: 'value', transform: 'trim|toNumber'},
          {to: 'unit', from: 'unit', transform: 'trim'},
          {to: 'threshold', from: 'threshold', transform: 'trim|toNumber'},
        ],
        links: [
          {
            type: 'mountedOn',
            toType: 'Equipment',
            toKey: 'equipmentId',
            split: ';',
          },
        ],
      },
    },
    {
      file: 'maintenance_records.csv',
      rows: maintenanceRecordRows(),
      mapping: {
        targetType: 'MaintenanceRecord',
        primaryKey: {from: 'recordId', transform: 'trim'},
        fields: [
          {to: 'recordId', from: 'recordId', transform: 'trim'},
          {to: 'equipmentId', from: 'equipmentId', transform: 'trim'},
          {to: 'type', from: 'type', transform: 'trim'},
          {to: 'date', from: 'date', transform: 'trim|parseDate'},
          {to: 'technician', from: 'technician', transform: 'trim'},
          {to: 'cost', from: 'cost', transform: 'trim|toNumber'},
        ],
        links: [
          {type: 'for', toType: 'Equipment', toKey: 'equipmentId', split: ';'},
        ],
      },
    },
  ];
}
