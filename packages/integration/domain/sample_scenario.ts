/**
 * @fileoverview Built-in supply-chain sample scenario (修订说明书: 80 objects,
 * 160 links), shipped with the code and written through the same mapping +
 * upsertBatch path as file imports. Property names follow the ontology
 * template: Supplier(supplierId, name, country, riskScore, capacity,
 * onTimeRate, status), Material(materialId, name, category, safetyStock,
 * stock, unitCost, leadTimeDays), Product(productId, name, category,
 * revenue (CNY/day), dailyDemand, status); links Supplier → Material
 * `supplies` (weight = share) and Material → Product `usedIn`.
 *
 * `samples/supply-chain/*.csv` contain exactly these rows (checked by a
 * test) so the manual import demo produces the same graph.
 */

import type {MappingSpec, Row} from '../contract';

/** One sample dataset: rows of one object type and their mapping. */
export interface SampleDataset {
  /** CSV file name under samples/supply-chain. */
  file: string;
  mapping: MappingSpec;
  rows: Row[];
}

const PRODUCT_NAMES = [
  'Edge Gateway X1',
  'Handheld Scanner S2',
  'Smart Sensor Hub',
  'Industrial Router R5',
  'Thermal Camera T3',
  'Asset Tracker A1',
  'Smart Meter M4',
  'Control Panel C7',
  'Robot Arm Controller',
  'Vision Module V2',
  'Charging Station E1',
  'Portable Power Bank',
  'Smart Lock L3',
  'Air Quality Monitor',
  'Drone Flight Unit',
  'POS Terminal P6',
  'Medical Pump Driver',
  'Solar Inverter S9',
  'Fleet Telematics Box',
  'Warehouse AGV Kit',
];

const MATERIAL_NAMES: Record<string, string[]> = {
  Electronics: [
    'Controller PCB',
    'Power IC',
    'MCU Chip',
    'Memory Module',
    'Wi-Fi Module',
    'Sensor Array',
    'Display Panel',
    'Connector Kit',
  ],
  Mechanical: [
    'Aluminium Housing',
    'Steel Bracket',
    'Precision Gear',
    'Bearing Set',
    'Hinge Assembly',
    'Fastener Pack',
    'Heat Sink',
    'Motor Shaft',
  ],
  Energy: [
    'Li-ion Cell',
    'Battery Pack',
    'Power Adapter',
    'Charging Coil',
    'DC-DC Converter',
    'Solar Film',
    'Supercapacitor',
    'Fuse Block',
  ],
  Packaging: [
    'Retail Box',
    'Foam Insert',
    'Pallet Wrap',
    'Label Roll',
    'Carton Divider',
    'Blister Tray',
    'Desiccant Pack',
    'Shipping Carton',
  ],
  Chemicals: [
    'Thermal Paste',
    'Conformal Coating',
    'Epoxy Resin',
    'Solder Paste',
    'Cleaning Solvent',
    'Adhesive Tape',
    'Silicone Gasket',
    'Flux Pen',
  ],
};

const CATEGORIES = Object.keys(MATERIAL_NAMES);

const PRODUCT_CATEGORIES = ['IoT', 'Industrial', 'Energy', 'Retail', 'Medical'];

/** [name, country, riskScore, capacity, onTimeRate, status]. */
const SUPPLIERS: [string, string, number, number, number, string][] = [
  ['Shenzhen Precision Parts', 'CN', 35, 1200, 0.96, 'active'],
  ['Hanoi Circuit Works', 'VN', 58, 800, 0.91, 'active'],
  ['Penang Semicon', 'MY', 76, 1500, 0.83, 'watch'],
  ['Osaka Battery Co', 'JP', 22, 600, 0.98, 'active'],
  ['Busan Metalworks', 'KR', 41, 950, 0.94, 'active'],
  ['Hsinchu Microdevices', 'TW', 64, 1100, 0.89, 'active'],
  ['Stuttgart Components', 'DE', 18, 700, 0.97, 'active'],
  ['Monterrey Plastics', 'MX', 82, 900, 0.78, 'watch'],
  ['Bangkok Packaging', 'TH', 30, 2000, 0.95, 'active'],
  ['Pune Chemicals', 'IN', 47, 1300, 0.9, 'active'],
  ['Suzhou Electronics', 'CN', 27, 1000, 0.95, 'active'],
  ['Da Nang Assembly', 'VN', 52, 650, 0.9, 'active'],
  ['Johor Energy Systems', 'MY', 39, 850, 0.93, 'active'],
  ['Nagoya Mechanics', 'JP', 71, 500, 0.86, 'watch'],
  ['Incheon Display Tech', 'KR', 33, 750, 0.96, 'active'],
  ['Taichung Tooling', 'TW', 45, 900, 0.92, 'active'],
  ['Ohio Industrial Supply', 'US', 24, 1100, 0.97, 'active'],
  ['Guadalajara Circuits', 'MX', 61, 600, 0.88, 'active'],
  ['Chonburi Materials', 'TH', 88, 1400, 0.72, 'suspended'],
  ['Chennai Polymers', 'IN', 36, 1250, 0.94, 'active'],
];

const pad = (n: number) => String(n).padStart(3, '0');
const productId = (i: number) => `P-${pad(i + 1)}`;
const materialId = (i: number) => `M-${pad(i + 1)}`;
const supplierId = (i: number) => `S-${pad(i + 1)}`;

/** Products: 20 rows. */
function productRows(): Row[] {
  return PRODUCT_NAMES.map((name, i) => {
    const dailyDemand = 50 + ((i * 29) % 11) * 25;
    const unitPrice = 200 + ((i * 17) % 9) * 100;
    return {
      productId: productId(i),
      name,
      category: PRODUCT_CATEGORIES[i % PRODUCT_CATEGORIES.length],
      revenue: dailyDemand * unitPrice,
      dailyDemand,
      status: 'active',
    };
  });
}

/** Materials: 40 rows, each used in 2 products (80 `usedIn` links). */
function materialRows(): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < 40; i++) {
    const category = CATEGORIES[i % CATEGORIES.length];
    const safetyStock = 200 + ((i * 37) % 9) * 50;
    const factor = i % 7 === 3 ? 0.6 : 1.4 + (i % 4) * 0.3;
    rows.push({
      materialId: materialId(i),
      name: MATERIAL_NAMES[category][Math.floor(i / CATEGORIES.length)],
      category,
      safetyStock,
      stock: Math.round(safetyStock * factor),
      unitCost: 5 + ((i * 13) % 20) * 4.5,
      leadTimeDays: 7 + ((i * 11) % 28),
      products: [productId(i % 20), productId((i * 7 + 3) % 20)].join(';'),
    });
  }
  return rows;
}

/**
 * Suppliers: 20 rows, each supplying 4 materials (80 `supplies` links).
 * S-001..S-010 are primary suppliers (share 0.7) of four consecutive
 * materials; S-011..S-020 are secondary suppliers (share 0.3), so the shares
 * of every material sum to 1.
 */
function supplierRows(): Row[] {
  return SUPPLIERS.map(([name, country, riskScore, capacity, rate, st], i) => {
    const primary = i < 10;
    const k = primary ? i : i - 10;
    const mats = primary
      ? [4 * k, 4 * k + 1, 4 * k + 2, 4 * k + 3]
      : [k, k + 10, k + 20, k + 30];
    return {
      supplierId: supplierId(i),
      name,
      country,
      riskScore,
      capacity,
      onTimeRate: rate,
      status: st,
      materials: mats.map(materialId).join(';'),
      share: primary ? 0.7 : 0.3,
    };
  });
}

/**
 * The sample datasets in write order (link targets first: products, then
 * materials, then suppliers).
 */
export function sampleDatasets(): SampleDataset[] {
  return [
    {
      file: 'products.csv',
      rows: productRows(),
      mapping: {
        targetType: 'Product',
        primaryKey: {from: 'productId', transform: 'trim'},
        fields: [
          {to: 'productId', from: 'productId', transform: 'trim'},
          {to: 'name', from: 'name', transform: 'trim'},
          {to: 'category', from: 'category', transform: 'trim'},
          {to: 'revenue', from: 'revenue', transform: 'trim|toNumber'},
          {to: 'dailyDemand', from: 'dailyDemand', transform: 'trim|toNumber'},
          {to: 'status', from: 'status', transform: 'trim'},
        ],
      },
    },
    {
      file: 'materials.csv',
      rows: materialRows(),
      mapping: {
        targetType: 'Material',
        primaryKey: {from: 'materialId', transform: 'trim'},
        fields: [
          {to: 'materialId', from: 'materialId', transform: 'trim'},
          {to: 'name', from: 'name', transform: 'trim'},
          {to: 'category', from: 'category', transform: 'trim'},
          {to: 'safetyStock', from: 'safetyStock', transform: 'trim|toNumber'},
          {to: 'stock', from: 'stock', transform: 'trim|toNumber'},
          {to: 'unitCost', from: 'unitCost', transform: 'trim|toNumber'},
          {
            to: 'leadTimeDays',
            from: 'leadTimeDays',
            transform: 'trim|toInteger',
          },
        ],
        links: [
          {type: 'usedIn', toType: 'Product', toKey: 'products', split: ';'},
        ],
      },
    },
    {
      file: 'suppliers.csv',
      rows: supplierRows(),
      mapping: {
        targetType: 'Supplier',
        primaryKey: {from: 'supplierId', transform: 'trim'},
        fields: [
          {to: 'supplierId', from: 'supplierId', transform: 'trim'},
          {to: 'name', from: 'name', transform: 'trim'},
          {to: 'country', from: 'country', transform: 'trim|upper'},
          {to: 'riskScore', from: 'riskScore', transform: 'trim|toNumber'},
          {to: 'capacity', from: 'capacity', transform: 'trim|toNumber'},
          {to: 'onTimeRate', from: 'onTimeRate', transform: 'trim|toNumber'},
          {to: 'status', from: 'status', transform: 'trim|lower'},
        ],
        links: [
          {
            type: 'supplies',
            toType: 'Material',
            toKey: 'materials',
            split: ';',
            weightFrom: 'share',
          },
        ],
      },
    },
  ];
}

/** Rows of the sample scenario (80). */
export const SAMPLE_ROWS = 80;

/**
 * D1 rows written by one sample load, charged against the global daily seed
 * budget. The design estimates ≈ 1,100 (详细设计 6.11.3); the write-budget
 * regression (tests/budget/write_budget_test.ts) measures ≈ 1,275 because
 * every secondary index row is billed (UNIQUE(type, primary key),
 * ix_prop_value, ix_link_dst), so the reservation uses the measured value.
 */
export const SAMPLE_SEED_ROWS = 1300;

/** Renders a dataset as CSV (header from the first row). */
export function toCsv(rows: readonly Row[]): string {
  const cols = Object.keys(rows[0] ?? {});
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return (
    [
      cols.join(','),
      ...rows.map(r => cols.map(c => cell(r[c])).join(',')),
    ].join('\n') + '\n'
  );
}
