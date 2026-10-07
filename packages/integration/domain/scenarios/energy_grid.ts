/**
 * @fileoverview Energy-grid sample scenario (26 objects, 24 links):
 * 8 PowerPlant (feeds), 10 Substation (connects), 8 TransmissionLine.
 * Includes offline plants, overloaded lines and emergency substations for
 * demo alerts. The `connects` link (Substation→Substation) is declared on the
 * Substation dataset because link validation requires the link type's `from`
 * to match the dataset target type.
 */

import type {Row, SampleDataset} from '../../contract';

const pad = (n: number) => String(n).padStart(3, '0');
const ss = (i: number) => `SS-${pad(i + 1)}`;
const pp = (i: number) => `PP-${pad(i + 1)}`;
const tl = (i: number) => `TL-${pad(i + 1)}`;

// [name, voltageKV, load, capacity, status, connected substations (indices)]
const SUBSTATIONS: [string, number, number, number, string, number[]][] = [
  ['North Hub', 500, 420, 500, 'normal', [1, 2]],
  ['East Junction', 220, 280, 300, 'warning', [0, 3]],
  ['West Switch', 220, 190, 300, 'normal', [0, 4]],
  ['South Terminal', 500, 510, 500, 'emergency', [1, 5]],
  ['Central Dist', 110, 95, 150, 'normal', [2, 6]],
  ['Port Sub', 220, 310, 300, 'warning', [3, 7]],
  ['Industrial A', 110, 140, 150, 'normal', [4, 8]],
  ['Industrial B', 110, 155, 150, 'warning', [5, 9]],
  ['Residential N', 35, 28, 50, 'normal', [6, 9]],
  ['Residential S', 35, 42, 50, 'warning', [7, 8]],
];

/** 10 substations with connects links between them. */
function substationRows(): Row[] {
  return SUBSTATIONS.map(([name, kv, load, cap, status, conn], i) => ({
    substationId: ss(i),
    name,
    voltageKV: kv,
    load,
    capacity: cap,
    loadRatio: Math.round((load / cap) * 100) / 100,
    status,
    connectedTo: conn.map(ss).join(';'),
  }));
}

const PLANTS: [string, string, number, number, string, number][] = [
  // [name, type, capacity, output, status, fed substation index]
  ['Solar Valley', 'solar', 200, 180, 'online', 0],
  ['Wind Ridge', 'wind', 150, 95, 'online', 1],
  ['Coal Creek', 'coal', 600, 620, 'online', 2],
  ['Gas Turbine', 'gas', 300, 0, 'offline', 3],
  ['Nuclear Point', 'nuclear', 1000, 980, 'online', 4],
  ['Solar Plains', 'solar', 120, 110, 'online', 5],
  ['Hydro Dam', 'gas', 400, 0, 'maintenance', 6],
  ['Wind Coast', 'wind', 180, 160, 'online', 7],
];

/** 8 power plants, each feeding one substation. */
function powerPlantRows(): Row[] {
  return PLANTS.map(([name, type, cap, out, status, fedIdx], i) => ({
    plantId: pp(i),
    name,
    type,
    capacity: cap,
    output: out,
    status,
    substation: ss(fedIdx),
  }));
}

const LINES: [number, number, number, number, string][] = [
  // [fromIdx, toIdx, current, capacity, status]
  [0, 1, 380, 400, 'normal'],
  [0, 2, 210, 300, 'normal'],
  [1, 3, 420, 400, 'overloaded'],
  [2, 4, 120, 200, 'normal'],
  [3, 5, 290, 300, 'normal'],
  [4, 6, 130, 150, 'normal'],
  [5, 7, 160, 150, 'overloaded'],
  [7, 9, 0, 100, 'down'],
];

/** 8 transmission lines. */
function transmissionLineRows(): Row[] {
  return LINES.map(([fromIdx, toIdx, current, cap, status], i) => ({
    lineId: tl(i),
    fromSubstation: ss(fromIdx),
    toSubstation: ss(toIdx),
    current,
    capacity: cap,
    status,
  }));
}

export function energyGridDatasets(): SampleDataset[] {
  return [
    {
      file: 'substations.csv',
      rows: substationRows(),
      mapping: {
        targetType: 'Substation',
        primaryKey: {from: 'substationId', transform: 'trim'},
        fields: [
          {to: 'substationId', from: 'substationId', transform: 'trim'},
          {to: 'name', from: 'name', transform: 'trim'},
          {to: 'voltageKV', from: 'voltageKV', transform: 'trim|toNumber'},
          {to: 'load', from: 'load', transform: 'trim|toNumber'},
          {to: 'capacity', from: 'capacity', transform: 'trim|toNumber'},
          {to: 'loadRatio', from: 'loadRatio', transform: 'trim|toNumber'},
          {to: 'status', from: 'status', transform: 'trim|lower'},
        ],
        links: [
          {
            type: 'connects',
            toType: 'Substation',
            toKey: 'connectedTo',
            split: ';',
          },
        ],
      },
    },
    {
      file: 'power_plants.csv',
      rows: powerPlantRows(),
      mapping: {
        targetType: 'PowerPlant',
        primaryKey: {from: 'plantId', transform: 'trim'},
        fields: [
          {to: 'plantId', from: 'plantId', transform: 'trim'},
          {to: 'name', from: 'name', transform: 'trim'},
          {to: 'type', from: 'type', transform: 'trim|lower'},
          {to: 'capacity', from: 'capacity', transform: 'trim|toNumber'},
          {to: 'output', from: 'output', transform: 'trim|toNumber'},
          {to: 'status', from: 'status', transform: 'trim|lower'},
        ],
        links: [
          {
            type: 'feeds',
            toType: 'Substation',
            toKey: 'substation',
            split: ';',
          },
        ],
      },
    },
    {
      file: 'transmission_lines.csv',
      rows: transmissionLineRows(),
      mapping: {
        targetType: 'TransmissionLine',
        primaryKey: {from: 'lineId', transform: 'trim'},
        fields: [
          {to: 'lineId', from: 'lineId', transform: 'trim'},
          {to: 'fromSubstation', from: 'fromSubstation', transform: 'trim'},
          {to: 'toSubstation', from: 'toSubstation', transform: 'trim'},
          {to: 'current', from: 'current', transform: 'trim|toNumber'},
          {to: 'capacity', from: 'capacity', transform: 'trim|toNumber'},
          {to: 'status', from: 'status', transform: 'trim|lower'},
        ],
      },
    },
  ];
}
