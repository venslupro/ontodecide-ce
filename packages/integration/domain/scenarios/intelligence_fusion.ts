/**
 * @fileoverview Intelligence-fusion sample scenario (33 objects, 26 links):
 * 15 Entity (relatedTo), 10 IntelligenceReport (mentions), 8 Relationship.
 * Includes high-risk entities and low-confidence reports for demo alerts.
 * The `relatedTo` link (Entity→Entity) is declared on the Entity dataset
 * because link validation requires the link type's `from` to match the
 * dataset target type.
 */

import type {Row, SampleDataset} from '../../contract';

const pad = (n: number) => String(n).padStart(3, '0');
const ent = (i: number) => `ENT-${pad(i + 1)}`;
const rpt = (i: number) => `RPT-${pad(i + 1)}`;
const rel = (i: number) => `REL-${pad(i + 1)}`;

// [name, type, riskLevel, related entity indices]
const ENTITIES: [string, string, number, number[]][] = [
  ['Alex Mercer', 'person', 82, [1, 5]],
  ['Northwind Trading', 'organization', 65, [0, 3]],
  ['Port of Rotterdam', 'location', 30, [1, 6]],
  ['Sarah Chen', 'person', 45, [1, 7]],
  ['Shadow Summit', 'event', 88, [0, 5]],
  ['Blackwood Corp', 'organization', 91, [0, 4]],
  ['Container Yard 7', 'location', 22, [2, 8]],
  ['James Park', 'person', 38, [3, 9]],
  ['Maria Lopez', 'person', 70, [6, 10]],
  ['East Gate Warehouse', 'location', 55, [7, 11]],
  ['Viktor Sokolov', 'person', 78, [8, 12]],
  ['Crimson Logistics', 'organization', 60, [9, 13]],
  ['David Kim', 'person', 25, [10, 14]],
  ['Freeport Zone', 'location', 48, [11]],
  ['Lisa Wang', 'person', 15, [12]],
];

/** 15 entities with relatedTo links between them. */
function entityRows(): Row[] {
  return ENTITIES.map(([name, type, risk, related], i) => ({
    entityId: ent(i),
    name,
    type,
    riskLevel: risk,
    relatedEntities: related.map(ent).join(';'),
  }));
}

// [title, source, confidence, classification, createdAt, mentioned entity indices]
const REPORTS: [string, string, number, string, string, number[]][] = [
  [
    'Suspicious Cargo Movement',
    'Port Authority',
    0.85,
    'confidential',
    '2026-10-01T08:30:00Z',
    [2, 6],
  ],
  [
    'Financial Anomaly Report',
    'Bank Compliance',
    0.72,
    'confidential',
    '2026-10-02T14:15:00Z',
    [1, 5],
  ],
  [
    'Meeting Intelligence',
    'Human Source',
    0.25,
    'secret',
    '2026-10-03T09:00:00Z',
    [0, 4],
  ],
  [
    'Container Inspection Log',
    'Customs',
    0.92,
    'open',
    '2026-10-03T16:45:00Z',
    [2, 7],
  ],
  [
    'Network Activity Alert',
    'Cyber Unit',
    0.68,
    'confidential',
    '2026-10-04T11:20:00Z',
    [5, 11],
  ],
  [
    'Travel Pattern Analysis',
    'Immigration',
    0.55,
    'confidential',
    '2026-10-04T20:10:00Z',
    [0, 8],
  ],
  [
    'Facility Surveillance',
    'Satellite Imagery',
    0.78,
    'secret',
    '2026-10-05T07:00:00Z',
    [6, 9],
  ],
  [
    'Transaction Monitoring',
    'FinCEN',
    0.18,
    'confidential',
    '2026-10-05T13:30:00Z',
    [3, 11],
  ],
  [
    'Personnel Movement',
    'Field Agent',
    0.62,
    'secret',
    '2026-10-06T10:00:00Z',
    [10, 12],
  ],
  [
    'Supply Chain Disruption',
    'Trade Data',
    0.81,
    'open',
    '2026-10-06T18:00:00Z',
    [11, 13],
  ],
];

/** 10 intelligence reports mentioning entities. */
function intelligenceReportRows(): Row[] {
  return REPORTS.map(([title, source, conf, cls, created, mentions], i) => ({
    reportId: rpt(i),
    title,
    source,
    confidence: conf,
    classification: cls,
    createdAt: created,
    entities: mentions.map(ent).join(';'),
  }));
}

// [type, confidence, description]
const RELATIONSHIPS: [string, number, string][] = [
  [
    'associatedWith',
    0.82,
    'Business partnership between Northwind and Blackwood',
  ],
  ['locatedAt', 0.95, 'Northwind Trading operates from Port of Rotterdam'],
  ['partOf', 0.7, 'Container Yard 7 is part of Port of Rotterdam'],
  ['associatedWith', 0.65, 'Sarah Chen is an employee of Northwind Trading'],
  ['locatedAt', 0.88, 'East Gate Warehouse is located in Freeport Zone'],
  ['associatedWith', 0.75, 'Crimson Logistics has ties to Blackwood Corp'],
  ['partOf', 0.9, 'Shadow Summit event involved Alex Mercer and Blackwood'],
  [
    'associatedWith',
    0.58,
    'Maria Lopez has known connections to Viktor Sokolov',
  ],
];

/** 8 relationships. */
function relationshipRows(): Row[] {
  return RELATIONSHIPS.map(([type, conf, desc], i) => ({
    relationshipId: rel(i),
    type,
    confidence: conf,
    description: desc,
  }));
}

export function intelligenceFusionDatasets(): SampleDataset[] {
  return [
    {
      file: 'entities.csv',
      rows: entityRows(),
      mapping: {
        targetType: 'Entity',
        primaryKey: {from: 'entityId', transform: 'trim'},
        fields: [
          {to: 'entityId', from: 'entityId', transform: 'trim'},
          {to: 'name', from: 'name', transform: 'trim'},
          {to: 'type', from: 'type', transform: 'trim|lower'},
          {to: 'riskLevel', from: 'riskLevel', transform: 'trim|toNumber'},
        ],
        links: [
          {
            type: 'relatedTo',
            toType: 'Entity',
            toKey: 'relatedEntities',
            split: ';',
          },
        ],
      },
    },
    {
      file: 'intelligence_reports.csv',
      rows: intelligenceReportRows(),
      mapping: {
        targetType: 'IntelligenceReport',
        primaryKey: {from: 'reportId', transform: 'trim'},
        fields: [
          {to: 'reportId', from: 'reportId', transform: 'trim'},
          {to: 'title', from: 'title', transform: 'trim'},
          {to: 'source', from: 'source', transform: 'trim'},
          {to: 'confidence', from: 'confidence', transform: 'trim|toNumber'},
          {
            to: 'classification',
            from: 'classification',
            transform: 'trim|lower',
          },
          {to: 'createdAt', from: 'createdAt', transform: 'trim'},
        ],
        links: [
          {type: 'mentions', toType: 'Entity', toKey: 'entities', split: ';'},
        ],
      },
    },
    {
      file: 'relationships.csv',
      rows: relationshipRows(),
      mapping: {
        targetType: 'Relationship',
        primaryKey: {from: 'relationshipId', transform: 'trim'},
        fields: [
          {to: 'relationshipId', from: 'relationshipId', transform: 'trim'},
          {to: 'type', from: 'type', transform: 'trim'},
          {to: 'confidence', from: 'confidence', transform: 'trim|toNumber'},
          {to: 'description', from: 'description', transform: 'trim'},
        ],
      },
    },
  ];
}
