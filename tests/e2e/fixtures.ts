/**
 * @fileoverview Supply-chain demo sources shared by the e2e tests and
 * scripts/smoke.mjs (same mappings).
 */

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {REPO_ROOT} from '../../packages/testing/index';

/** Parses a simple (unquoted) CSV sample file. */
export function readSample(file: string): Record<string, string>[] {
  const text = readFileSync(
    join(REPO_ROOT, 'samples', 'supply-chain', file),
    'utf8',
  );
  const [header, ...lines] = text.trim().split('\n');
  const cols = header.split(',');
  return lines.map(l =>
    Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])),
  );
}

/** Source definitions for the three sample files. */
export const SOURCES = [
  {
    file: 'suppliers.csv',
    def: {
      name: 'Suppliers',
      kind: 'file',
      config: {format: 'csv'},
      mapping: {
        targetType: 'Supplier',
        primaryKey: {from: 'supplierId'},
        fields: [
          {to: 'supplierId', from: 'supplierId'},
          {to: 'name', from: 'name', transform: 'trim'},
          {to: 'country', from: 'country'},
          {
            to: 'riskScore',
            from: 'riskScore',
            transform: 'toNumber|clamp(0,100)',
          },
          {to: 'capacity', from: 'capacity', transform: 'toNumber'},
          {to: 'onTimeRate', from: 'onTimeRate', transform: 'toNumber'},
          {to: 'status', from: 'status'},
          {to: 'contactEmail', from: 'contactEmail'},
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
  },
  {
    file: 'materials.csv',
    def: {
      name: 'Materials',
      kind: 'file',
      config: {format: 'csv'},
      mapping: {
        targetType: 'Material',
        primaryKey: {from: 'materialId'},
        fields: [
          {to: 'materialId', from: 'materialId'},
          {to: 'name', from: 'name'},
          {to: 'category', from: 'category'},
          {to: 'unitCost', from: 'unitCost', transform: 'toNumber'},
        ],
        links: [
          {type: 'usedIn', toType: 'Product', toKey: 'products', split: ';'},
        ],
      },
    },
  },
  {
    file: 'products.csv',
    def: {
      name: 'Products',
      kind: 'file',
      config: {format: 'csv'},
      mapping: {
        targetType: 'Product',
        primaryKey: {from: 'productId'},
        fields: [
          {to: 'productId', from: 'productId'},
          {to: 'name', from: 'name'},
          {to: 'dailyDemand', from: 'dailyDemand', transform: 'toNumber'},
          {to: 'inventoryDays', from: 'inventoryDays', transform: 'toNumber'},
          {
            to: 'safetyStockDays',
            from: 'safetyStockDays',
            transform: 'toNumber',
          },
          {to: 'revenuePerUnit', from: 'revenuePerUnit', transform: 'toNumber'},
        ],
      },
    },
  },
] as const;
