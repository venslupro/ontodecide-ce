/**
 * @fileoverview Urban-emergency sample scenario (30 objects, 30 links):
 * 12 TrafficNode, 12 Camera (monitors), 6 Incident (occursAt). Includes
 * high-congestion and critical-incident data points for demo alerts.
 */

import type {Row, SampleDataset} from '../../contract';

const pad = (n: number) => String(n).padStart(3, '0');
const tn = (i: number) => `TN-${pad(i + 1)}`;
const cam = (i: number) => `CAM-${pad(i + 1)}`;
const inc = (i: number) => `INC-${pad(i + 1)}`;

const NODES: [string, string, number, string][] = [
  ['Central Plaza', 'Downtown', 78, 'congested'],
  ['Riverside Avenue', 'Downtown', 32, 'normal'],
  ['North Gate Junction', 'North District', 91, 'blocked'],
  ['University Crossroad', 'North District', 45, 'congested'],
  ['West Park Loop', 'West District', 18, 'normal'],
  ['Mall Intersection', 'West District', 62, 'congested'],
  ['Steel Plant Gate', 'East Industrial', 27, 'normal'],
  ['Chemicals Depot', 'East Industrial', 11, 'normal'],
  ['Port Terminal A', 'South Port', 55, 'congested'],
  ['Port Terminal B', 'South Port', 7, 'normal'],
  ['Highway E1 Ramp', 'East Industrial', 83, 'congested'],
  ['Bridge Southbound', 'South Port', 96, 'blocked'],
];

/** 12 traffic nodes. */
function trafficNodeRows(): Row[] {
  return NODES.map(([name, area, level, status], i) => ({
    trafficNodeId: tn(i),
    name,
    area,
    congestionLevel: level,
    status,
  }));
}

/** 12 cameras, each monitoring one traffic node. */
function cameraRows(): Row[] {
  return Array.from({length: 12}, (_, i) => {
    const status = i === 5 || i === 9 ? 'offline' : 'online';
    return {
      cameraId: cam(i),
      name: `${NODES[i][0]} Camera`,
      location: NODES[i][0],
      status,
      node: tn(i),
    };
  });
}

/** 6 incidents, each occurring at one traffic node. */
function incidentRows(): Row[] {
  const data: [string, string, string, string, string][] = [
    [
      'accident',
      'HIGH',
      'open',
      'Rear-end collision on Riverside Avenue',
      tn(1),
    ],
    [
      'fire',
      'CRITICAL',
      'open',
      'Warehouse fire near North Gate Junction',
      tn(2),
    ],
    [
      'congestion',
      'MEDIUM',
      'resolved',
      'Rush hour congestion at Mall Intersection',
      tn(5),
    ],
    ['flooding', 'HIGH', 'open', 'Waterlogging at Port Terminal A', tn(8)],
    [
      'collision',
      'CRITICAL',
      'open',
      'Multi-vehicle pile-up on Bridge Southbound',
      tn(11),
    ],
    [
      'roadwork',
      'LOW',
      'resolved',
      'Scheduled roadwork on West Park Loop',
      tn(4),
    ],
  ];
  return data.map(([type, severity, status, description, node], i) => ({
    incidentId: inc(i),
    type,
    severity,
    status,
    description,
    node,
  }));
}

export function urbanEmergencyDatasets(): SampleDataset[] {
  return [
    {
      file: 'traffic_nodes.csv',
      rows: trafficNodeRows(),
      mapping: {
        targetType: 'TrafficNode',
        primaryKey: {from: 'trafficNodeId', transform: 'trim'},
        fields: [
          {to: 'trafficNodeId', from: 'trafficNodeId', transform: 'trim'},
          {to: 'name', from: 'name', transform: 'trim'},
          {to: 'area', from: 'area', transform: 'trim'},
          {
            to: 'congestionLevel',
            from: 'congestionLevel',
            transform: 'trim|toNumber',
          },
          {to: 'status', from: 'status', transform: 'trim|lower'},
        ],
      },
    },
    {
      file: 'cameras.csv',
      rows: cameraRows(),
      mapping: {
        targetType: 'Camera',
        primaryKey: {from: 'cameraId', transform: 'trim'},
        fields: [
          {to: 'cameraId', from: 'cameraId', transform: 'trim'},
          {to: 'name', from: 'name', transform: 'trim'},
          {to: 'location', from: 'location', transform: 'trim'},
          {to: 'status', from: 'status', transform: 'trim|lower'},
        ],
        links: [
          {type: 'monitors', toType: 'TrafficNode', toKey: 'node', split: ';'},
        ],
      },
    },
    {
      file: 'incidents.csv',
      rows: incidentRows(),
      mapping: {
        targetType: 'Incident',
        primaryKey: {from: 'incidentId', transform: 'trim'},
        fields: [
          {to: 'incidentId', from: 'incidentId', transform: 'trim'},
          {to: 'type', from: 'type', transform: 'trim'},
          {to: 'severity', from: 'severity', transform: 'trim|upper'},
          {to: 'status', from: 'status', transform: 'trim|lower'},
          {to: 'description', from: 'description', transform: 'trim'},
        ],
        links: [
          {type: 'occursAt', toType: 'TrafficNode', toKey: 'node', split: ';'},
        ],
      },
    },
  ];
}
