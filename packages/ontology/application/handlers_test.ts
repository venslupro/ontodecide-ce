/**
 * @fileoverview Integration tests of the ontology use cases over D1
 * (node:sqlite) and an in-memory KV.
 */

import {AppError, FixedClock, silentLogger} from '@ontodecide/shared-kernel';
import {
  createTestD1,
  MemoryKV,
  testCtx,
  type SqliteD1,
} from '@ontodecide/testing';
import {beforeEach, describe, expect, it} from 'vitest';
import type {OntologyPack, SchemaDef} from '../contract';
import {SUPPLY_CHAIN_PACK} from '../domain';
import {
  D1SchemaRepository,
  TieredSchemaCache,
  modelKvKey,
  schemaKvKey,
} from '../infrastructure';
import {createOntologyHandlers, type OntologyHandlers} from './handlers';

const ctx = testCtx({role: 'Modeler'});
const other = testCtx({tenantId: 't2', role: 'Modeler'});

function schema(): SchemaDef {
  return {
    apiName: 'plant',
    displayName: {'zh-CN': '工厂', 'en-US': 'Plant'},
    objectTypes: [
      {
        apiName: 'Machine',
        displayName: 'Machine',
        primaryKey: 'machineId',
        titleProperty: 'name',
        properties: [
          {
            apiName: 'machineId',
            displayName: 'ID',
            dataType: 'string',
            required: true,
          },
          {
            apiName: 'name',
            displayName: 'Name',
            dataType: 'string',
            indexed: true,
          },
          {
            apiName: 'temperature',
            displayName: 'Temperature',
            dataType: 'double',
            indexed: true,
          },
        ],
      },
    ],
    linkTypes: [],
    actionTypes: [],
    functions: [
      {
        apiName: 'overheated',
        objectType: 'Machine',
        expr: {'>': [{var: 'temperature'}, 90]},
        returns: 'boolean',
      },
    ],
  };
}

async function expectCode(
  p: Promise<unknown>,
  code: string,
): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    const err = AppError.from(e);
    expect(err.code).toBe(code);
    return err;
  }
  throw new Error(`Expected ${code}`);
}

describe('ontology use cases', () => {
  let db: D1Database;
  let kv: MemoryKV;
  let clock: FixedClock;
  let h: OntologyHandlers;

  const build = (): OntologyHandlers => {
    const cache = new TieredSchemaCache(kv.asKV(), clock, silentLogger);
    return createOntologyHandlers({
      repo: new D1SchemaRepository(db),
      cache,
      clock,
      logger: silentLogger,
    });
  };
  const queries = () => (db as unknown as SqliteD1).queries;

  beforeEach(() => {
    db = createTestD1('ontology');
    kv = new MemoryKV();
    clock = new FixedClock('2026-09-24T00:00:00Z');
    h = build();
  });

  it('draft → diff → publish → getSchema current/draft/semver', async () => {
    const draft = await h.saveDraft.execute(ctx, 'plant', schema());
    expect(draft).toEqual({
      apiName: 'plant',
      version: 'draft',
      savedAt: '2026-09-24T00:00:00.000Z',
      validation: [],
    });
    const diff = await h.diff.execute(ctx, 'plant');
    expect(diff).toMatchObject({
      fromVersion: null,
      toVersion: '1.0.0',
      breaking: false,
    });

    const report = await h.publish.execute(ctx, 'plant');
    expect(report.version).toBe('1.0.0');
    expect(report.indexChanges).toEqual([
      {objectType: 'Machine', prop: 'name', kind: 'str'},
      {objectType: 'Machine', prop: 'temperature', kind: 'num'},
    ]);

    const current = await h.getSchema.execute(ctx, 'plant');
    expect(current).toMatchObject({
      version: '1.0.0',
      status: 'PUBLISHED',
      publishedBy: 'u1',
      publishedAt: '2026-09-24T00:00:00.000Z',
    });
    expect(current.definition.version).toBe('1.0.0');
    expect((await h.getSchema.execute(ctx, 'plant', '1.0.0')).status).toBe(
      'PUBLISHED',
    );
    await expectCode(h.getSchema.execute(ctx, 'plant', 'draft'), 'NOT_FOUND');
    await expectCode(
      h.getSchema.execute(ctx, 'plant', 'latest'),
      'VALIDATION_FAILED',
    );
    await expectCode(h.diff.execute(ctx, 'plant'), 'NOT_FOUND');

    // A new draft coexists with the published version.
    const next = schema();
    next.objectTypes[0].properties.push({
      apiName: 'site',
      displayName: 'Site',
      dataType: 'string',
    });
    await h.saveDraft.execute(ctx, 'plant', next);
    expect((await h.getSchema.execute(ctx, 'plant', 'draft')).status).toBe(
      'DRAFT',
    );
    expect((await h.diff.execute(ctx, 'plant')).suggestedVersion).toBe('1.1.0');
    expect(await h.listSchemas.execute(ctx)).toEqual([
      {
        apiName: 'plant',
        displayName: {'zh-CN': '工厂', 'en-US': 'Plant'},
        currentVersion: '1.0.0',
        hasDraft: true,
        objectTypeCount: 1,
        publishedAt: '2026-09-24T00:00:00.000Z',
      },
    ]);
    clock.advance(1000);
    expect((await h.publish.execute(ctx, 'plant')).version).toBe('1.1.0');
    expect((await h.getSchema.execute(ctx, 'plant')).version).toBe('1.1.0');
    expect(
      (await h.getSchema.execute(ctx, 'plant', '1.0.0')).definition
        .objectTypes[0].properties,
    ).toHaveLength(3);
  });

  it('rejects zod-invalid drafts and saves structurally invalid ones with issues', async () => {
    await expectCode(
      h.saveDraft.execute(ctx, 'plant', {
        ...schema(),
        objectTypes: 'nope',
      } as never),
      'VALIDATION_FAILED',
    );
    await expectCode(
      h.saveDraft.execute(ctx, 'other', schema()),
      'VALIDATION_FAILED',
    );

    const broken = schema();
    broken.objectTypes[0].primaryKey = 'ghost';
    const saved = await h.saveDraft.execute(ctx, 'plant', broken);
    expect(saved.validation).toEqual([
      {
        path: 'objectTypes.0.primaryKey',
        message: 'Primary key property does not exist: ghost',
      },
    ]);
    expect(
      (await h.getSchema.execute(ctx, 'plant', 'draft')).definition
        .objectTypes[0].primaryKey,
    ).toBe('ghost');
    const err = await expectCode(
      h.publish.execute(ctx, 'plant'),
      'ONTOLOGY_INVALID',
    );
    expect(err.extras.issues).toHaveLength(1);
    // The draft is left untouched.
    expect((await h.getSchema.execute(ctx, 'plant', 'draft')).status).toBe(
      'DRAFT',
    );
  });

  it('rejects breaking changes until the major is bumped and confirmed', async () => {
    await h.saveDraft.execute(ctx, 'plant', schema());
    await h.publish.execute(ctx, 'plant');

    const breaking = schema();
    breaking.objectTypes[0].properties.pop();
    breaking.functions = [];
    await h.saveDraft.execute(ctx, 'plant', {...breaking, version: '1.1.0'});
    let err = await expectCode(
      h.publish.execute(ctx, 'plant'),
      'ONTOLOGY_BREAKING_CHANGE',
    );
    expect(err.extras.diff).toMatchObject({
      breaking: true,
      suggestedVersion: '2.0.0',
    });

    // Suggested major bump but not confirmed.
    await h.saveDraft.execute(ctx, 'plant', breaking);
    err = await expectCode(
      h.publish.execute(ctx, 'plant'),
      'ONTOLOGY_BREAKING_CHANGE',
    );
    await expectCode(
      h.publish.execute(ctx, 'plant', {confirmVersion: '3.0.0'}),
      'ONTOLOGY_BREAKING_CHANGE',
    );
    expect((await h.getSchema.execute(ctx, 'plant', 'draft')).status).toBe(
      'DRAFT',
    );
    expect((await h.getSchema.execute(ctx, 'plant')).version).toBe('1.0.0');

    const report = await h.publish.execute(ctx, 'plant', {
      confirmVersion: '2.0.0',
    });
    expect(report).toMatchObject({version: '2.0.0', diff: {breaking: true}});
    expect((await h.getSchema.execute(ctx, 'plant')).version).toBe('2.0.0');
  });

  it('published versions are immutable', async () => {
    await h.saveDraft.execute(ctx, 'plant', schema());
    await h.publish.execute(ctx, 'plant');
    const changed = schema();
    changed.displayName = 'Changed';
    await h.saveDraft.execute(ctx, 'plant', {...changed, version: '1.0.0'});
    const report = await h.publish.execute(ctx, 'plant');
    expect(report.version).toBe('1.0.1');
    expect(
      (await h.getSchema.execute(ctx, 'plant', '1.0.0')).definition.displayName,
    ).toEqual({
      'zh-CN': '工厂',
      'en-US': 'Plant',
    });
  });

  it('imports the supply chain pack (idempotently) and exports it back', async () => {
    const packs = await h.listPacks.execute(ctx);
    expect(packs).toEqual([
      expect.objectContaining({id: 'supply-chain', builtIn: true}),
    ]);

    const {report, pack} = await h.importPack.execute(ctx, {
      packId: 'supply-chain',
    });
    expect(report).toMatchObject({apiName: 'supplyChain', version: '1.0.0'});
    expect(pack.automations).toHaveLength(2);
    const writes = kv.writes;
    expect(writes).toBe(2);

    const again = await h.importPack.execute(ctx, {packId: 'supply-chain'});
    expect(again.report).toMatchObject({
      version: '1.0.0',
      diff: {changes: [], fromVersion: '1.0.0'},
      publishedAt: report.publishedAt,
    });
    expect(kv.writes).toBe(writes);

    const exported = await h.exportPack.execute(ctx, 'supplyChain');
    expect(exported).toMatchObject({id: 'supply-chain', version: '1.0.0'});
    expect(exported.kpis).toHaveLength(4);
    expect(exported.schema.objectTypes).toHaveLength(3);
    await expectCode(h.importPack.execute(ctx, {packId: 'nope'}), 'NOT_FOUND');
    await expectCode(h.importPack.execute(ctx, {}), 'VALIDATION_FAILED');
  });

  it('imports inline packs and lists them for the tenant only', async () => {
    const inline: OntologyPack = {
      id: 'plant-pack',
      name: 'Plant',
      version: '0.2.0',
      schema: schema(),
    };
    const {report} = await h.importPack.execute(ctx, {pack: inline});
    expect(report.version).toBe('0.2.0');
    expect(
      (await h.listPacks.execute(ctx)).map(p => [p.id, p.builtIn]),
    ).toEqual([
      ['supply-chain', true],
      ['plant-pack', false],
    ]);
    expect((await h.getPack.execute(ctx, 'plant-pack')).version).toBe('0.2.0');
    expect(await h.listPacks.execute(other)).toHaveLength(1);
    await expectCode(h.getPack.execute(other, 'plant-pack'), 'NOT_FOUND');
    await expectCode(
      h.importPack.execute(ctx, {pack: {...SUPPLY_CHAIN_PACK}}),
      'CONFLICT',
    );
  });

  it('enforces cross-schema api name uniqueness at publish', async () => {
    await h.importPack.execute(ctx, {packId: 'supply-chain'});
    const clash = schema();
    clash.objectTypes.push(
      structuredClone(SUPPLY_CHAIN_PACK.schema.objectTypes[0]),
    );
    const saved = await h.saveDraft.execute(ctx, 'plant', clash);
    expect(saved.validation).toEqual([
      {
        path: 'objectTypes.1.apiName',
        message:
          'Object type Supplier is already defined by schema supplyChain',
      },
    ]);
    await expectCode(h.publish.execute(ctx, 'plant'), 'ONTOLOGY_INVALID');
  });

  it('getActiveModel: empty tenant, after import and merged across schemas', async () => {
    const empty = await h.getActiveModel.execute(ctx);
    expect(empty).toMatchObject({
      tenantId: 't1',
      version: '0',
      schemas: [],
      objectTypes: {},
    });

    await h.importPack.execute(ctx, {packId: 'supply-chain'});
    const model = await h.getActiveModel.execute(ctx);
    expect(model.version).toBe('supplyChain@1.0.0');
    expect(Object.keys(model.objectTypes)).toEqual([
      'Supplier',
      'Material',
      'Product',
    ]);
    expect(JSON.parse(kv.data.get(modelKvKey('t1'))!.value).version).toBe(
      'supplyChain@1.0.0',
    );
    expect(kv.data.has(schemaKvKey('t1', 'supplyChain'))).toBe(true);

    await h.saveDraft.execute(ctx, 'plant', schema());
    await h.publish.execute(ctx, 'plant');
    expect((await h.getActiveModel.execute(ctx)).version).toBe(
      'plant@1.0.0+supplyChain@1.0.0',
    );
  });

  it('serves the model and compiled schema from cache without D1', async () => {
    await h.importPack.execute(ctx, {packId: 'supply-chain'});

    // Same isolate: memory tier.
    let before = queries();
    await h.getActiveModel.execute(ctx);
    await h.getCompiledSchema.execute(ctx, 'supplyChain');
    expect(queries()).toBe(before);

    // New isolate: KV tier.
    h = build();
    before = queries();
    const model = await h.getActiveModel.execute(ctx);
    const compiled = await h.getCompiledSchema.execute(ctx, 'supplyChain');
    expect(model.version).toBe('supplyChain@1.0.0');
    expect(compiled.objectTypes.Supplier.sensitiveProps).toEqual([
      'contactEmail',
    ]);
    expect(queries()).toBe(before);

    // Specific versions are not in KV: first read hits D1, second is memory.
    before = queries();
    await h.getCompiledSchema.execute(ctx, 'supplyChain', '1.0.0');
    const afterFirst = queries();
    expect(afterFirst).toBeGreaterThan(before);
    await h.getCompiledSchema.execute(ctx, 'supplyChain', '1.0.0');
    expect(queries()).toBe(afterFirst);

    // Empty tenant with no KV entry: D1 once, then memory for 30 s.
    before = queries();
    await h.getActiveModel.execute(other);
    const afterEmpty = queries();
    await h.getActiveModel.execute(other);
    expect(queries()).toBe(afterEmpty);
    clock.advance(31_000);
    await h.getActiveModel.execute(other);
    expect(queries()).toBeGreaterThan(afterEmpty);
    expect(afterEmpty).toBeGreaterThan(before);
  });

  it('isolates tenants', async () => {
    await h.importPack.execute(ctx, {packId: 'supply-chain'});
    await h.saveDraft.execute(ctx, 'plant', schema());
    expect(await h.listSchemas.execute(other)).toEqual([]);
    await expectCode(h.getSchema.execute(other, 'supplyChain'), 'NOT_FOUND');
    await expectCode(
      h.getCompiledSchema.execute(other, 'supplyChain'),
      'NOT_FOUND',
    );
    await expectCode(h.diff.execute(other, 'plant'), 'NOT_FOUND');
    expect((await h.getActiveModel.execute(other)).version).toBe('0');

    await h.saveDraft.execute(other, 'plant', schema());
    await h.publish.execute(other, 'plant');
    expect((await h.getActiveModel.execute(other)).version).toBe('plant@1.0.0');
    expect((await h.getActiveModel.execute(ctx)).version).toBe(
      'supplyChain@1.0.0',
    );
  });

  it('evaluates functions of the active model', async () => {
    await expectCode(
      h.evaluateFunction.execute(ctx, 'supplierRiskLevel', {}),
      'NOT_FOUND',
    );
    await h.importPack.execute(ctx, {packId: 'supply-chain'});
    expect(
      await h.evaluateFunction.execute(ctx, 'supplierRiskLevel', {
        riskScore: 72,
      }),
    ).toBe('HIGH');
    expect(
      await h.evaluateFunction.execute(ctx, 'coverageDays', {
        inventoryDays: 10,
        safetyStockDays: 4,
      }),
    ).toBe(6);
    await expectCode(
      h.evaluateFunction.execute(ctx, 'toString', {}),
      'NOT_FOUND',
    );
  });

  it('compiles drafts on demand', async () => {
    await h.saveDraft.execute(ctx, 'plant', schema());
    const c = await h.getCompiledSchema.execute(ctx, 'plant', 'draft');
    expect(c.version).toBe('draft');
    await expectCode(h.getCompiledSchema.execute(ctx, 'plant'), 'NOT_FOUND');
  });
});
