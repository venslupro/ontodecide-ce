/**
 * @fileoverview Test fixtures: the compiled supply-chain model (built by hand
 * from the built-in pack) and message builders for object-writes.
 */

import type {ObjectWriteMsg, UpsertCmd} from '@ontodecide/integration/contract';
import type {
  ActionTypeDef,
  CompiledModel,
  CompiledObjectType,
  LinkTypeDef,
  ObjectTypeDef,
  PropertyDef,
} from '@ontodecide/ontology/contract';
import type {CallCtx, Provenance} from '@ontodecide/shared-kernel';

const p = (
  apiName: string,
  dataType: PropertyDef['dataType'],
  extra: Partial<PropertyDef> = {},
): PropertyDef => ({apiName, displayName: apiName, dataType, ...extra});

const OBJECT_TYPES: ObjectTypeDef[] = [
  {
    apiName: 'Supplier',
    displayName: 'Supplier',
    primaryKey: 'supplierId',
    titleProperty: 'name',
    graphProjected: true,
    properties: [
      p('supplierId', 'string', {required: true}),
      p('name', 'string', {required: true, indexed: true}),
      p('country', 'string', {indexed: true}),
      p('riskScore', 'double', {indexed: true}),
      p('capacity', 'double', {indexed: true}),
      p('onTimeRate', 'double'),
      p('status', 'enum', {
        enumValues: ['active', 'watch', 'suspended'],
        indexed: true,
      }),
      p('contactEmail', 'string', {sensitive: true, markings: ['PII']}),
    ],
  },
  {
    apiName: 'Material',
    displayName: 'Material',
    primaryKey: 'materialId',
    titleProperty: 'name',
    graphProjected: true,
    properties: [
      p('materialId', 'string', {required: true}),
      p('name', 'string', {required: true, indexed: true}),
      p('category', 'string', {indexed: true}),
      p('unitCost', 'double', {markings: ['FINANCE']}),
    ],
  },
  {
    apiName: 'Product',
    displayName: 'Product',
    primaryKey: 'productId',
    titleProperty: 'name',
    graphProjected: true,
    properties: [
      p('productId', 'string', {required: true}),
      p('name', 'string', {required: true, indexed: true}),
      p('dailyDemand', 'double', {indexed: true}),
      p('inventoryDays', 'double', {indexed: true}),
      p('safetyStockDays', 'double'),
      p('revenuePerUnit', 'double', {markings: ['FINANCE']}),
    ],
  },
];

const LINK_TYPES: LinkTypeDef[] = [
  {
    apiName: 'supplies',
    displayName: 'Supplies',
    from: 'Supplier',
    to: 'Material',
    cardinality: 'many',
    propagation: {defaultWeight: 1},
  },
  {
    apiName: 'usedIn',
    displayName: 'Used in',
    from: 'Material',
    to: 'Product',
    cardinality: 'many',
    propagation: {defaultWeight: 1},
  },
];

/** The pack's action types. */
export const ACTION_TYPES: ActionTypeDef[] = [
  {
    apiName: 'switchSupplier',
    displayName: 'Switch supplier',
    targetType: 'Material',
    parameters: [
      {
        apiName: 'newSupplier',
        displayName: 'New supplier',
        dataType: 'objectRef:Supplier',
        required: true,
      },
    ],
    preconditions: [],
    effects: [
      {
        kind: 'relink',
        link: 'supplies',
        direction: 'in',
        toParam: 'newSupplier',
      },
    ],
    requiresApproval: true,
    writeback: {kind: 'none'},
  },
  {
    apiName: 'increaseSafetyStock',
    displayName: 'Increase safety stock',
    targetType: 'Product',
    parameters: [
      {
        apiName: 'days',
        displayName: 'Extra days',
        dataType: 'integer',
        required: true,
        defaultValue: 7,
      },
    ],
    preconditions: [
      {
        expr: {
          and: [
            {'>': [{var: 'params.days'}, 0]},
            {'<=': [{var: 'params.days'}, 30]},
          ],
        },
        message: {
          'zh-CN': '增加天数须在 1–30 之间',
          'en-US': 'Extra days must be between 1 and 30',
        },
      },
    ],
    effects: [
      {kind: 'increment', prop: 'inventoryDays', by: {var: 'params.days'}},
      {kind: 'increment', prop: 'safetyStockDays', by: {var: 'params.days'}},
    ],
    requiresApproval: true,
    writeback: {kind: 'none'},
  },
  {
    apiName: 'flagSupplier',
    displayName: 'Flag supplier',
    targetType: 'Supplier',
    parameters: [
      {apiName: 'reason', displayName: 'Reason', dataType: 'string'},
    ],
    preconditions: [
      {
        expr: {'!==': [{var: 'target.status'}, 'suspended']},
        message: {
          'zh-CN': '已停用的供应商不能标记',
          'en-US': 'Suspended suppliers cannot be flagged',
        },
      },
    ],
    effects: [{kind: 'set', prop: 'status', value: 'watch'}],
    requiresApproval: false,
    writeback: {kind: 'none'},
  },
];

function compile(t: ObjectTypeDef): CompiledObjectType {
  return {
    ...t,
    schemaApi: 'supplyChain',
    propsByName: Object.fromEntries(t.properties.map(x => [x.apiName, x])),
    indexedProps: t.properties.filter(x => x.indexed).map(x => x.apiName),
    sensitiveProps: t.properties.filter(x => x.sensitive).map(x => x.apiName),
  };
}

/** Options for the model fixture. */
export interface ModelOptions {
  version?: string;
  /** Webhook URL for flagSupplier writeback. */
  flagWritebackUrl?: string;
  /** Extra indexed properties, e.g. `{Supplier: ['onTimeRate']}`. */
  extraIndexed?: Record<string, string[]>;
}

/** The compiled supply-chain model of a tenant. */
export function supplyChainModel(
  tenantId: string,
  opts: ModelOptions = {},
): CompiledModel {
  const types = OBJECT_TYPES.map(t => ({
    ...t,
    properties: t.properties.map(prop =>
      opts.extraIndexed?.[t.apiName]?.includes(prop.apiName)
        ? {...prop, indexed: true}
        : prop,
    ),
  })).map(compile);
  const actions = ACTION_TYPES.map(a =>
    a.apiName === 'flagSupplier' && opts.flagWritebackUrl
      ? {
          ...a,
          writeback: {kind: 'webhook' as const, url: opts.flagWritebackUrl},
        }
      : a,
  );
  return {
    tenantId,
    version: opts.version ?? '1.0.0',
    hash: 'h',
    schemas: [{apiName: 'supplyChain', version: opts.version ?? '1.0.0'}],
    objectTypes: Object.fromEntries(types.map(t => [t.apiName, t])),
    linkTypes: Object.fromEntries(LINK_TYPES.map(l => [l.apiName, l])),
    actionTypes: Object.fromEntries(actions.map(a => [a.apiName, a])),
    functions: {},
    simulationKpis: [],
    indexPlan: types.flatMap(t =>
      t.indexedProps.map(prop => ({
        objectType: t.apiName,
        prop,
        kind:
          t.propsByName[prop].dataType === 'double'
            ? ('num' as const)
            : ('str' as const),
      })),
    ),
  };
}

/** Provenance for a test record. */
export function prov(
  sourceId: string,
  row: number,
  extra: Partial<Provenance> = {},
): Provenance {
  return {
    sourceId,
    datasetTxn: 'txn',
    recordRef: `row-${row}`,
    ingestedAt: '2026-09-24T00:00:00.000Z',
    confidence: 0.9,
    ...extra,
  };
}

/** Builds an upsert command. */
export function cmd(
  type: string,
  primaryKey: string,
  props: Record<string, unknown>,
  opts: {
    row?: number;
    links?: UpsertCmd['links'];
    source?: string;
    provenance?: Partial<Provenance>;
    externalKey?: string;
  } = {},
): UpsertCmd {
  const row = opts.row ?? 1;
  return {
    type,
    primaryKey,
    props,
    links: opts.links ?? [],
    provenance: prov(opts.source ?? `src-${type}`, row, opts.provenance),
    row,
    ...(opts.externalKey ? {externalKey: opts.externalKey} : {}),
  };
}

/** Builds an object-writes message. */
export function writeMsg(
  ctx: CallCtx,
  jobId: string,
  cmds: UpsertCmd[],
  opts: {seq?: number; last?: boolean; policy?: ObjectWriteMsg['policy']} = {},
): ObjectWriteMsg {
  return {
    ctx,
    jobId,
    seq: opts.seq ?? 0,
    last: opts.last ?? true,
    schemaVersion: '1.0.0',
    policy: opts.policy ?? 'latest-wins',
    cmds,
  };
}

/** Supplier records (S1 high risk). */
export function supplierCmds(): UpsertCmd[] {
  return [
    cmd(
      'Supplier',
      'S1',
      {
        name: 'Acme Metals',
        country: 'CN',
        riskScore: 80,
        capacity: 100,
        onTimeRate: 0.7,
        status: 'active',
        contactEmail: 'acme@example.com',
      },
      {
        row: 1,
        links: [
          {type: 'supplies', toType: 'Material', toKey: 'M1', weight: 0.6},
          {type: 'supplies', toType: 'Material', toKey: 'M2'},
        ],
      },
    ),
    cmd(
      'Supplier',
      'S2',
      {
        name: 'Beta Parts',
        country: 'DE',
        riskScore: 30,
        capacity: 80,
        onTimeRate: 0.95,
        status: 'active',
      },
      {row: 2},
    ),
    cmd(
      'Supplier',
      'S3',
      {
        name: 'Gamma Supply',
        country: 'US',
        riskScore: 45,
        capacity: 60,
        onTimeRate: 0.85,
        status: 'active',
      },
      {row: 3, links: [{type: 'supplies', toType: 'Material', toKey: 'M2'}]},
    ),
  ];
}

/** Material records. */
export function materialCmds(): UpsertCmd[] {
  return [
    cmd(
      'Material',
      'M1',
      {name: 'Steel', category: 'metal', unitCost: 10},
      {row: 1, links: [{type: 'usedIn', toType: 'Product', toKey: 'P1'}]},
    ),
    cmd(
      'Material',
      'M2',
      {name: 'Copper', category: 'metal', unitCost: 25},
      {
        row: 2,
        links: [
          {type: 'usedIn', toType: 'Product', toKey: 'P1'},
          {type: 'usedIn', toType: 'Product', toKey: 'P2'},
        ],
      },
    ),
  ];
}

/** Product records. */
export function productCmds(): UpsertCmd[] {
  return [
    cmd(
      'Product',
      'P1',
      {
        name: 'Widget',
        dailyDemand: 100,
        inventoryDays: 10,
        safetyStockDays: 5,
        revenuePerUnit: 9,
      },
      {row: 1},
    ),
    cmd(
      'Product',
      'P2',
      {
        name: 'Gadget',
        dailyDemand: 50,
        inventoryDays: 4,
        safetyStockDays: 3,
        revenuePerUnit: 20,
      },
      {row: 2},
    ),
  ];
}
