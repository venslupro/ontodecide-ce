/**
 * @fileoverview Test fixture: a hand-compiled model for Supplier / Material
 * / Product consistent with the built-in supply-chain pack, plus a tiny CSV
 * parser for the sample files. Not exported from the domain index.
 */

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {
  CompiledModel,
  CompiledObjectType,
  DataType,
  PropertyDef,
} from '@ontodecide/ontology/contract';
import type {MappingSpec} from '../contract';

function prop(
  apiName: string,
  dataType: DataType,
  extra: Partial<PropertyDef> = {},
): PropertyDef {
  return {apiName, displayName: {'en-US': apiName}, dataType, ...extra};
}

function objectType(
  apiName: string,
  primaryKey: string,
  properties: PropertyDef[],
): CompiledObjectType {
  return {
    apiName,
    displayName: {'en-US': apiName},
    primaryKey,
    titleProperty: 'name',
    properties,
    graphProjected: true,
    schemaApi: 'supplyChain',
    propsByName: Object.fromEntries(properties.map(p => [p.apiName, p])),
    indexedProps: properties.filter(p => p.indexed).map(p => p.apiName),
    sensitiveProps: properties.filter(p => p.sensitive).map(p => p.apiName),
  };
}

/** Builds the compiled supply-chain model for a tenant. */
export function supplyChainModel(
  tenantId = 't1',
  version = '1.0.0',
): CompiledModel {
  const supplier = objectType('Supplier', 'supplierId', [
    prop('supplierId', 'string', {required: true}),
    prop('name', 'string', {required: true, indexed: true}),
    prop('country', 'string', {indexed: true}),
    prop('riskScore', 'double', {indexed: true}),
    prop('capacity', 'double', {indexed: true}),
    prop('onTimeRate', 'double'),
    prop('status', 'enum', {
      enumValues: ['active', 'watch', 'suspended'],
      indexed: true,
    }),
    prop('contactEmail', 'string', {sensitive: true, markings: ['PII']}),
  ]);
  const material = objectType('Material', 'materialId', [
    prop('materialId', 'string', {required: true}),
    prop('name', 'string', {required: true, indexed: true}),
    prop('category', 'string', {indexed: true}),
    prop('unitCost', 'double'),
  ]);
  const product = objectType('Product', 'productId', [
    prop('productId', 'string', {required: true}),
    prop('name', 'string', {required: true, indexed: true}),
    prop('dailyDemand', 'double', {indexed: true}),
    prop('inventoryDays', 'double', {indexed: true}),
    prop('safetyStockDays', 'double'),
    prop('revenuePerUnit', 'double'),
  ]);
  return {
    tenantId,
    version,
    hash: `h-${version}`,
    schemas: [{apiName: 'supplyChain', version}],
    objectTypes: {Supplier: supplier, Material: material, Product: product},
    linkTypes: {
      supplies: {
        apiName: 'supplies',
        displayName: {'en-US': 'Supplies'},
        from: 'Supplier',
        to: 'Material',
        cardinality: 'many',
        propagation: {defaultWeight: 1},
      },
      usedIn: {
        apiName: 'usedIn',
        displayName: {'en-US': 'Used in'},
        from: 'Material',
        to: 'Product',
        cardinality: 'many',
        propagation: {defaultWeight: 1},
      },
    },
    actionTypes: {},
    functions: {},
    simulationKpis: [],
    indexPlan: [],
  };
}

/** Mapping of samples/supply-chain/suppliers.csv onto Supplier. */
export const SUPPLIER_MAPPING: MappingSpec = {
  targetType: 'Supplier',
  primaryKey: {from: 'supplierId', transform: 'trim'},
  fields: [
    {to: 'name', from: 'name', transform: 'trim'},
    {to: 'country', from: 'country', transform: 'trim|iso3166'},
    {to: 'riskScore', from: 'riskScore', transform: 'toNumber|clamp(0,100)'},
    {to: 'capacity', from: 'capacity', transform: 'toNumber'},
    {to: 'onTimeRate', from: 'onTimeRate', transform: 'toNumber'},
    {to: 'status', from: 'status', transform: 'trim|lower'},
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
};

/** Parses a simple CSV (no quoted separators) into records. */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  const [header, ...rows] = lines;
  const cols = header.split(',');
  return rows.map(line => {
    const cells = line.split(',');
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? '']));
  });
}

/** Reads and parses a sample CSV from samples/supply-chain. */
export function readSampleCsv(name: string): Record<string, string>[] {
  const path = join(
    import.meta.dirname,
    '..',
    '..',
    '..',
    'samples',
    'supply-chain',
    name,
  );
  return parseCsv(readFileSync(path, 'utf8'));
}
