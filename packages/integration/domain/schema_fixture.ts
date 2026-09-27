/**
 * @fileoverview Test fixture: a hand-compiled supply-chain schema matching
 * the ontology template's property names (sample_scenario_test also
 * checks the sample against the real compiled template).
 */

import type {
  CompiledObjectType,
  CompiledSchema,
  DataType,
  LinkTypeDef,
  PropertyDef,
} from '@ontodecide/ontology/contract';

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
  displayName: Record<'zh-CN' | 'en-US', string>,
  properties: PropertyDef[],
): CompiledObjectType {
  return {
    apiName,
    displayName,
    primaryKey,
    titleProperty: 'name',
    properties,
    propsByName: Object.fromEntries(properties.map(p => [p.apiName, p])),
    indexedProps: properties.filter(p => p.indexed).map(p => p.apiName),
    sensitiveProps: properties.filter(p => p.sensitive).map(p => p.apiName),
  };
}

function link(apiName: string, from: string, to: string): LinkTypeDef {
  return {apiName, displayName: apiName, from, to, cardinality: 'many'};
}

/** Compiled supply-chain schema. */
export function supplyChainSchema(): CompiledSchema {
  const supplier = objectType(
    'Supplier',
    'supplierId',
    {'zh-CN': '供应商', 'en-US': 'Supplier'},
    [
      prop('supplierId', 'string', {
        required: true,
        displayName: {'zh-CN': '供应商编号', 'en-US': 'Supplier ID'},
      }),
      prop('name', 'string', {required: true, indexed: true}),
      prop('country', 'string', {indexed: true}),
      prop('riskScore', 'double', {
        indexed: true,
        displayName: {'zh-CN': '风险分', 'en-US': 'Risk score'},
      }),
      prop('capacity', 'double'),
      prop('onTimeRate', 'double'),
      prop('status', 'enum', {enumValues: ['active', 'watch', 'suspended']}),
      prop('contactEmail', 'string', {sensitive: true}),
    ],
  );
  const material = objectType(
    'Material',
    'materialId',
    {'zh-CN': '物料', 'en-US': 'Material'},
    [
      prop('materialId', 'string', {required: true}),
      prop('name', 'string', {required: true}),
      prop('category', 'string'),
      prop('stock', 'double'),
      prop('safetyStock', 'double'),
      prop('unitCost', 'double'),
      prop('leadTimeDays', 'integer'),
    ],
  );
  const product = objectType(
    'Product',
    'productId',
    {'zh-CN': '产品', 'en-US': 'Product'},
    [
      prop('productId', 'string', {required: true}),
      prop('name', 'string', {required: true}),
      prop('category', 'string'),
      prop('revenue', 'double'),
      prop('dailyDemand', 'double'),
      prop('status', 'enum', {
        enumValues: ['active', 'atRisk', 'discontinued'],
      }),
    ],
  );
  return {
    templateId: 'supply-chain',
    templateVersion: '2.4.0',
    custom: false,
    etag: 0,
    objectTypes: {Supplier: supplier, Material: material, Product: product},
    linkTypes: {
      supplies: link('supplies', 'Supplier', 'Material'),
      usedIn: link('usedIn', 'Material', 'Product'),
    },
    actionTypes: {},
    functions: {},
    simulationKpis: [],
    indexPlan: [],
  };
}
