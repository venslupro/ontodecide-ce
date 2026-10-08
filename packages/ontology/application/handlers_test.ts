/**
 * @fileoverview Use-case tests against the real ontology-manager migrations:
 * template seeding, copy-on-write, If-Match / etag concurrency, structural
 * validation, tenant isolation and tombstoned workspaces.
 */

import {AppError, FixedClock, silentLogger} from '@ontodecide/shared-kernel';
import {writeTombstone} from '@ontodecide/shared-kernel/d1';
import {createTestD1, TEST_TID, testCtx} from '@ontodecide/testing';
import {beforeEach, describe, expect, it} from 'vitest';
import {BUILT_IN_TEMPLATE_IDS, BLANK_TEMPLATE_ID, SUPPLY_CHAIN_TEMPLATE_ID} from '../contract';
import type {LinkTypeDef, ObjectTypeDef} from '../contract';
import {
  SUPPLY_CHAIN_DEFINITION,
  SUPPLY_CHAIN_TEMPLATE_VERSION,
} from '../domain';
import {
  D1TemplateRepository,
  D1WorkspaceSchemaRepository,
  MemoryCompiledCache,
} from '../infrastructure';
import {createOntologyHandlers, type OntologyHandlers} from './handlers';

const OTHER_TID = '01K6A000000000000000000T02';

const WAREHOUSE: ObjectTypeDef = {
  apiName: 'Warehouse',
  displayName: {'zh-CN': '仓库', 'en-US': 'Warehouse'},
  primaryKey: 'warehouseId',
  titleProperty: 'name',
  properties: [
    {
      apiName: 'warehouseId',
      displayName: 'ID',
      dataType: 'string',
      required: true,
    },
    {apiName: 'name', displayName: 'Name', dataType: 'string', indexed: true},
  ],
};

const STORED_IN: LinkTypeDef = {
  apiName: 'storedIn',
  displayName: 'Stored in',
  from: 'Material',
  to: 'Warehouse',
  cardinality: 'many',
};

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return AppError.from(e).code;
  }
  return 'OK';
}

describe('ontology use cases', () => {
  let db: D1Database;
  let cache: MemoryCompiledCache;
  let clock: FixedClock;
  let h: OntologyHandlers;
  const ctx = testCtx();
  const other = testCtx({tid: OTHER_TID});

  beforeEach(() => {
    db = createTestD1('ontology-manager');
    cache = new MemoryCompiledCache();
    clock = new FixedClock('2026-09-24T00:00:00Z');
    h = createOntologyHandlers({
      schemas: tid => new D1WorkspaceSchemaRepository(db, tid),
      templates: new D1TemplateRepository(db),
      cache,
      clock,
      logger: silentLogger,
    });
  });

  const workspaceRows = async () =>
    (
      await db
        .prepare(
          'SELECT tenant_id, etag FROM ont_workspace_schema ORDER BY tenant_id',
        )
        .all<{tenant_id: string; etag: number}>()
    ).results;

  it('seeds ont_template from code on first use, once', async () => {
    await h.getCompiledSchema(ctx);
    await h.getOntology(ctx);
    const rows = (
      await db
        .prepare('SELECT * FROM ont_template ORDER BY template_id')
        .all<Record<string, string>>()
    ).results;
    // All built-in templates are seeded (not only the default).
    expect(rows).toHaveLength(BUILT_IN_TEMPLATE_IDS.length);
    const sc = rows.find(r => r.template_id === SUPPLY_CHAIN_TEMPLATE_ID)!;
    expect(sc).toMatchObject({
      template_id: SUPPLY_CHAIN_TEMPLATE_ID,
      version: SUPPLY_CHAIN_TEMPLATE_VERSION,
    });
    expect(JSON.parse(sc.definition)).toEqual(SUPPLY_CHAIN_DEFINITION);
    expect(JSON.parse(sc.compiled).objectTypes.Supplier.indexedProps).toContain(
      'riskScore',
    );
    expect(JSON.parse(sc.kpi_seed).length).toBeGreaterThanOrEqual(3);
    expect(JSON.parse(sc.automation_seed).length).toBe(2);

    // A second isolate seeding the same templates is a no-op.
    const again = createOntologyHandlers({
      schemas: tid => new D1WorkspaceSchemaRepository(db, tid),
      templates: new D1TemplateRepository(db),
      cache,
      clock,
      logger: silentLogger,
    });
    await again.getTemplateSeeds(SUPPLY_CHAIN_TEMPLATE_ID);
    const n = await db
      .prepare('SELECT COUNT(*) AS n FROM ont_template')
      .first('n');
    expect(n).toBe(BUILT_IN_TEMPLATE_IDS.length);
  });

  it('serves the blank template until a scenario is loaded', async () => {
    const a = await h.getCompiledSchema(ctx);
    const b = await h.getCompiledSchema(other);
    expect(a).toMatchObject({
      custom: false,
      etag: 0,
      templateId: BLANK_TEMPLATE_ID,
    });
    expect(a).toBe(b); // shared compiled template
    const dto = await h.getOntology(ctx);
    expect(dto).toMatchObject({custom: false, etag: 0, updatedAt: null});
    expect(dto.definition).toEqual({
      objectTypes: [],
      linkTypes: [],
      actionTypes: [],
      functions: [],
      simulationKpis: [],
    });
    const list = await h.listDefinitions(ctx, 'object-types');
    expect(list).toMatchObject({etag: 0, custom: false});
    expect(list.items).toEqual([]);
    expect(await codeOf(h.getDefinition(ctx, 'link-types', 'nope'))).toBe(
      'NOT_FOUND',
    );
    expect(await workspaceRows()).toEqual([]);
  });

  it('copies the template on the first change (copy-on-write)', async () => {
    // Load the supply-chain scenario so the workspace has a concrete ontology.
    await h.setTemplate(ctx, SUPPLY_CHAIN_TEMPLATE_ID);

    expect(
      await h.putDefinition(ctx, 'object-types', 'Warehouse', WAREHOUSE, 1),
    ).toEqual({
      etag: 2,
    });
    expect(await workspaceRows()).toEqual([{tenant_id: TEST_TID, etag: 2}]);

    const compiled = await h.getCompiledSchema(ctx);
    expect(compiled).toMatchObject({
      custom: true,
      etag: 2,
      templateId: 'supply-chain',
    });
    expect(Object.keys(compiled.objectTypes)).toEqual([
      'Supplier',
      'Material',
      'Product',
      'Warehouse',
    ]);
    expect(compiled.indexPlan).toContainEqual({
      objectType: 'Warehouse',
      prop: 'name',
    });

    clock.advance(1000);
    expect(
      await h.putDefinition(ctx, 'link-types', 'storedIn', STORED_IN, 2),
    ).toEqual({
      etag: 3,
    });
    const dto = await h.getOntology(ctx);
    expect(dto).toMatchObject({
      custom: true,
      etag: 3,
      updatedAt: '2026-09-24T00:00:01.000Z',
    });
    expect(dto.definition.linkTypes.map(l => l.apiName)).toContain('storedIn');
    // The template itself is untouched.
    expect(SUPPLY_CHAIN_DEFINITION.objectTypes).toHaveLength(3);
  });

  it('replaces an existing definition in place', async () => {
    await h.setTemplate(ctx, SUPPLY_CHAIN_TEMPLATE_ID);
    const supplier = (await h.getDefinition(ctx, 'object-types', 'Supplier'))
      .item;
    const changed = {...supplier, icon: 'truck'};
    await h.putDefinition(ctx, 'object-types', 'Supplier', changed, 1);
    const {item, etag} = await h.getDefinition(ctx, 'object-types', 'Supplier');
    expect(item.icon).toBe('truck');
    expect(etag).toBe(2);
    expect((await h.listDefinitions(ctx, 'object-types')).items).toHaveLength(
      3,
    );
  });

  it('requires If-Match to be 0 while the template is referenced', async () => {
    expect(
      await codeOf(
        h.putDefinition(ctx, 'object-types', 'Warehouse', WAREHOUSE, 1),
      ),
    ).toBe('PRECONDITION_FAILED');
    expect(await workspaceRows()).toEqual([]);
  });

  it('lets exactly one of two concurrent first changes win', async () => {
    const results = await Promise.all([
      codeOf(h.putDefinition(ctx, 'object-types', 'Warehouse', WAREHOUSE, 0)),
      codeOf(
        h.putDefinition(
          ctx,
          'object-types',
          'Depot',
          {...WAREHOUSE, apiName: 'Depot'},
          0,
        ),
      ),
    ]);
    expect(results.sort()).toEqual(['OK', 'PRECONDITION_FAILED']);
    expect(await workspaceRows()).toEqual([{tenant_id: TEST_TID, etag: 1}]);
  });

  it('lets exactly one of two puts with the same If-Match win', async () => {
    await h.setTemplate(ctx, SUPPLY_CHAIN_TEMPLATE_ID);
    await h.putDefinition(ctx, 'object-types', 'Warehouse', WAREHOUSE, 1);
    const results = await Promise.all([
      codeOf(h.putDefinition(ctx, 'link-types', 'storedIn', STORED_IN, 2)),
      codeOf(
        h.putDefinition(
          ctx,
          'object-types',
          'Depot',
          {...WAREHOUSE, apiName: 'Depot'},
          2,
        ),
      ),
    ]);
    expect(results.sort()).toEqual(['OK', 'PRECONDITION_FAILED']);
    expect((await h.getOntology(ctx)).etag).toBe(3);
    // A stale If-Match is rejected with the current etag in the problem.
    try {
      await h.putDefinition(ctx, 'link-types', 'storedIn', STORED_IN, 2);
      expect.unreachable();
    } catch (e) {
      const err = AppError.from(e);
      expect(err.code).toBe('PRECONDITION_FAILED');
      expect(err.extras).toEqual({etag: 3});
    }
  });

  it('rejects structurally invalid changes with issues and keeps the copy', async () => {
    const bad = {...STORED_IN, to: 'Nowhere'};
    try {
      await h.putDefinition(ctx, 'link-types', 'storedIn', bad, 0);
      expect.unreachable();
    } catch (e) {
      const err = AppError.from(e);
      expect(err.code).toBe('VALIDATION_FAILED');
      expect(err.extras.issues).toEqual(
        expect.arrayContaining([
          {
            path: 'linkTypes.0.from',
            message: 'Object type does not exist: Material',
          },
          {
            path: 'linkTypes.0.to',
            message: 'Object type does not exist: Nowhere',
          },
        ]),
      );
    }
    expect(await workspaceRows()).toEqual([]);

    const tooMany: ObjectTypeDef = {
      ...WAREHOUSE,
      properties: Array.from({length: 9}, (_, i) => ({
        apiName: i === 0 ? 'warehouseId' : i === 1 ? 'name' : `p${i}`,
        displayName: 'p',
        dataType: 'string' as const,
        indexed: true,
      })),
    };
    expect(
      await codeOf(
        h.putDefinition(ctx, 'object-types', 'Warehouse', tooMany, 0),
      ),
    ).toBe('VALIDATION_FAILED');
    // Body shape errors (zod) and id / apiName mismatch.
    expect(
      await codeOf(
        h.putDefinition(
          ctx,
          'object-types',
          'Warehouse',
          {apiName: 'Warehouse'} as ObjectTypeDef,
          0,
        ),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(
      await codeOf(h.putDefinition(ctx, 'object-types', 'Depot', WAREHOUSE, 0)),
    ).toBe('VALIDATION_FAILED');
    expect(
      await codeOf(
        h.putDefinition(ctx, 'functions' as 'object-types', 'x', WAREHOUSE, 0),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(await workspaceRows()).toEqual([]);
  });

  it('deletes definitions but rejects deleting referenced ones', async () => {
    await h.setTemplate(ctx, SUPPLY_CHAIN_TEMPLATE_ID);
    try {
      await h.deleteDefinition(ctx, 'object-types', 'Supplier', 1);
      expect.unreachable();
    } catch (e) {
      const err = AppError.from(e);
      expect(err.code).toBe('VALIDATION_FAILED');
      expect(JSON.stringify(err.extras.issues)).toContain('link type supplies');
    }
    expect(
      await codeOf(h.deleteDefinition(ctx, 'link-types', 'supplies', 1)),
    ).toBe('VALIDATION_FAILED');
    expect(
      await codeOf(h.deleteDefinition(ctx, 'link-types', 'ghost', 1)),
    ).toBe('NOT_FOUND');
    // Failed deletes don't change the etag.
    expect(await workspaceRows()).toEqual([{tenant_id: TEST_TID, etag: 1}]);

    // Deleting an unreferenced definition succeeds.
    expect(
      await h.deleteDefinition(ctx, 'action-types', 'flagSupplier', 1),
    ).toEqual({etag: 2});
    expect(
      (await h.listDefinitions(ctx, 'action-types')).items.map(a => a.apiName),
    ).toEqual(['switchSupplier', 'adjustSafetyStock']);
    expect(
      await codeOf(
        h.deleteDefinition(ctx, 'action-types', 'switchSupplier', 1),
      ),
    ).toBe('PRECONDITION_FAILED');
    await h.deleteDefinition(ctx, 'action-types', 'switchSupplier', 2);
    expect(await h.deleteDefinition(ctx, 'link-types', 'supplies', 3)).toEqual({
      etag: 4,
    });
  });

  it('isolates workspaces', async () => {
    await h.putDefinition(ctx, 'object-types', 'Warehouse', WAREHOUSE, 0);
    expect(
      (await h.getCompiledSchema(other)).objectTypes.Warehouse,
    ).toBeUndefined();
    expect((await h.getOntology(other)).custom).toBe(false);
    expect(
      await codeOf(h.getDefinition(other, 'object-types', 'Warehouse')),
    ).toBe('NOT_FOUND');
    // The other workspace starts its own copy from the blank template at etag 0.
    await h.putDefinition(
      other,
      'object-types',
      'Depot',
      {...WAREHOUSE, apiName: 'Depot'},
      0,
    );
    expect(await workspaceRows()).toEqual(
      expect.arrayContaining([
        {tenant_id: TEST_TID, etag: 1},
        {tenant_id: OTHER_TID, etag: 1},
      ]),
    );
    expect(await workspaceRows()).toHaveLength(2);
    expect(
      (await h.getCompiledSchema(ctx)).objectTypes.Depot,
    ).toBeUndefined();
  });

  it('caches compiled copies by (tid, etag)', async () => {
    await h.putDefinition(ctx, 'object-types', 'Warehouse', WAREHOUSE, 0);
    const first = await h.getCompiledSchema(ctx);
    expect(await h.getCompiledSchema(ctx)).toBe(first);
    // A cold isolate rebuilds from the stored compiled form.
    const cold = createOntologyHandlers({
      schemas: tid => new D1WorkspaceSchemaRepository(db, tid),
      templates: new D1TemplateRepository(db),
      cache: new MemoryCompiledCache(),
      clock,
      logger: silentLogger,
    });
    const rebuilt = await cold.getCompiledSchema(ctx);
    expect(rebuilt).toEqual(first);
    expect(rebuilt).not.toBe(first);
  });

  it('treats a tombstoned workspace as empty / not found', async () => {
    await h.putDefinition(ctx, 'object-types', 'Warehouse', WAREHOUSE, 0);
    await db
      .prepare('DELETE FROM ont_workspace_schema WHERE tenant_id = ?1')
      .bind(TEST_TID)
      .run();
    await writeTombstone(db, TEST_TID, clock.now().getTime()).run();

    const compiled = await h.getCompiledSchema(ctx);
    expect(compiled.objectTypes).toEqual({});
    expect(compiled.indexPlan).toEqual([]);
    const dto = await h.getOntology(ctx);
    expect(dto.definition.objectTypes).toEqual([]);
    expect((await h.listDefinitions(ctx, 'object-types')).items).toEqual([]);
    expect(await codeOf(h.getDefinition(ctx, 'object-types', 'Supplier'))).toBe(
      'NOT_FOUND',
    );
    expect(
      await codeOf(
        h.putDefinition(ctx, 'object-types', 'Warehouse', WAREHOUSE, 0),
      ),
    ).toBe('NOT_FOUND');
    expect(await workspaceRows()).toEqual([]);
  });

  it('returns template seeds and NOT_FOUND for unknown templates', async () => {
    const seeds = await h.getTemplateSeeds(SUPPLY_CHAIN_TEMPLATE_ID);
    expect(seeds.kpis.find(k => k.id === 'highRiskSuppliers')).toMatchObject({
      objectType: 'Supplier',
      aggregate: {fn: 'count'},
      filter: {op: 'gte', prop: 'riskScore', value: 70},
    });
    expect(seeds.automations.map(a => a.trigger).sort()).toEqual([
      'schedule',
      'threshold',
    ]);
    expect(await codeOf(h.getTemplateSeeds('retail'))).toBe('NOT_FOUND');
  });
});
