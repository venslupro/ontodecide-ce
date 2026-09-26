/**
 * @fileoverview Pack use cases: ListPacks, GetPack, ImportPack, ExportPack.
 */

import {AppError, parseOrThrow, type CallCtx} from '@ontodecide/shared-kernel';
import {z} from 'zod';
import {
  importPackInputSchema,
  schemaDefSchema,
  type OntologyPack,
  type PackSummary,
  type PublishReport,
} from '../contract';
import {PackRegistry, compareSemver, schemaHash} from '../domain';
import type {OntologyDeps} from './ports';
import type {PublishHandler} from './publish';
import {
  parseSchemaDef,
  schemaIssues,
  type SaveDraftHandler,
} from './save_draft';
import {iso, otherDefinitions} from './support';

const i18nText = z.union([z.string(), z.record(z.string(), z.string())]);

/** Zod schema of an inline pack. */
export const ontologyPackSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, 'Invalid pack id'),
  name: i18nText,
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Invalid version'),
  description: i18nText.optional(),
  schema: schemaDefSchema,
  automations: z.array(z.unknown()).optional(),
  kpis: z.array(z.unknown()).optional(),
  sampleData: z
    .array(
      z.object({
        objectType: z.string(),
        rows: z.array(z.record(z.string(), z.unknown())),
      }),
    )
    .optional(),
});

/** Lists built-in and tenant packs. */
export class ListPacksHandler {
  constructor(
    private readonly deps: OntologyDeps,
    private readonly registry: PackRegistry,
  ) {}

  async execute(ctx: CallCtx): Promise<PackSummary[]> {
    return this.registry.list(await this.deps.repo.listPacks(ctx.tenantId));
  }
}

/** Returns one pack (built-in first, then the tenant's). */
export class GetPackHandler {
  constructor(
    private readonly deps: OntologyDeps,
    private readonly registry: PackRegistry,
  ) {}

  async execute(ctx: CallCtx, id: string): Promise<OntologyPack> {
    const pack =
      this.registry.builtIn(id) ??
      (await this.deps.repo.getPack(ctx.tenantId, id));
    if (!pack) throw new AppError('NOT_FOUND', `Pack ${id} not found`);
    return pack;
  }
}

/**
 * Imports a pack (by id or inline) and publishes its schema at the pack's
 * version. Re-importing the same version with the same content returns the
 * existing publish report without writing.
 */
export class ImportPackHandler {
  constructor(
    private readonly deps: OntologyDeps,
    private readonly registry: PackRegistry,
    private readonly getPack: GetPackHandler,
    private readonly saveDraft: SaveDraftHandler,
    private readonly publish: PublishHandler,
  ) {}

  async execute(
    ctx: CallCtx,
    input: {packId?: string; pack?: OntologyPack},
  ): Promise<{report: PublishReport; pack: OntologyPack}> {
    const parsed = parseOrThrow(importPackInputSchema, input ?? {});
    let pack: OntologyPack;
    let inline = false;
    if (parsed.pack) {
      pack = parseOrThrow(ontologyPackSchema, parsed.pack) as OntologyPack;
      if (this.registry.isBuiltIn(pack.id)) {
        throw new AppError(
          'CONFLICT',
          `Pack id ${pack.id} is reserved by a built-in pack`,
        );
      }
      inline = true;
    } else {
      pack = await this.getPack.execute(ctx, parsed.packId!);
    }

    const api = pack.schema.apiName;
    const def = parseSchemaDef(api, {
      ...pack.schema,
      version: pack.schema.version ?? pack.version,
    });
    const version = def.version!;
    const {repo, clock} = this.deps;
    const allCurrent = await repo.listCurrent(ctx.tenantId);
    const current = allCurrent.find(r => r.apiName === api);

    if (current) {
      const cmp = compareSemver(version, current.version);
      if (cmp === 0) {
        const existingHash =
          current.compiled?.hash ?? (await schemaHash(current.definition));
        if (existingHash !== (await schemaHash(def))) {
          throw new AppError(
            'CONFLICT',
            `Schema ${api}@${version} is already published with different content`,
          );
        }
        if (inline)
          await repo.savePack(ctx.tenantId, pack, clock.now().getTime());
        return {
          report: existingReport(api, version, current.publishedAt),
          pack,
        };
      }
      if (cmp < 0) {
        throw new AppError(
          'CONFLICT',
          `Schema ${api}@${current.version} is newer than pack version ${version}`,
        );
      }
    }

    // Validate before touching the draft so a bad pack leaves it unchanged.
    const issues = schemaIssues(def, otherDefinitions(allCurrent, api));
    if (issues.length) {
      throw new AppError('ONTOLOGY_INVALID', issues[0].message, {issues});
    }
    await this.saveDraft.execute(ctx, api, def);
    const report = await this.publish.execute(ctx, api, {
      confirmVersion: version,
    });
    if (inline) await repo.savePack(ctx.tenantId, pack, clock.now().getTime());
    return {report, pack};
  }
}

function existingReport(
  api: string,
  version: string,
  publishedAt: number | null,
): PublishReport {
  return {
    apiName: api,
    version,
    diff: {
      apiName: api,
      fromVersion: version,
      toVersion: version,
      breaking: false,
      changes: [],
      suggestedVersion: version,
    },
    indexChanges: [],
    publishedAt: iso(publishedAt ?? 0),
  };
}

/** Exports the current published schema as a pack. */
export class ExportPackHandler {
  constructor(
    private readonly deps: OntologyDeps,
    private readonly registry: PackRegistry,
  ) {}

  async execute(ctx: CallCtx, api: string): Promise<OntologyPack> {
    const current = await this.deps.repo.getCurrent(ctx.tenantId, api);
    if (!current)
      throw new AppError('NOT_FOUND', `Schema ${api} has no published version`);
    const base = this.registry.findBySchema(
      api,
      await this.deps.repo.listPacks(ctx.tenantId),
    );
    const def = current.definition;
    const description = base?.description ?? def.description;
    return {
      id: base?.id ?? api,
      name: base?.name ?? def.displayName,
      version: current.version,
      ...(description !== undefined ? {description} : {}),
      schema: def,
      ...(base?.automations ? {automations: base.automations} : {}),
      ...(base?.kpis ? {kpis: base.kpis} : {}),
    };
  }
}
