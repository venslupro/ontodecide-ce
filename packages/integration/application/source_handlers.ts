/**
 * @fileoverview Source use cases: list, get, create, update, delete and
 * pause-on-breaking-change. Webhook secrets and REST secret headers are
 * stored AES-GCM encrypted and never returned (except the webhook secret,
 * once, on creation).
 */

import {AppError, parseOrThrow, randomToken} from '@ontodecide/shared-kernel';
import type {CallCtx} from '@ontodecide/shared-kernel';
import {z} from 'zod';
import type {SourceDef, SourceDto} from '../contract';
import {INGEST_LIMITS, sourceDefSchema} from '../contract';
import {parseJsonPath, validateMapping} from '../domain';
import type {AppDeps, SourceRecord, SourceSecrets} from './ports';
import {requireRole, toSourceDto} from './views';

const restConfigSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST']).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  secretHeaders: z.record(z.string(), z.string()).optional(),
  itemsPath: z.string().min(1),
  cursorParam: z.string().min(1).optional(),
  cursorPath: z.string().min(1).optional(),
  pageLimit: z
    .number()
    .int()
    .min(1)
    .max(INGEST_LIMITS.restPageLimitMax)
    .optional(),
});

const webhookConfigSchema = z.object({itemsPath: z.string().min(1).optional()});

const fileConfigSchema = z.object({
  format: z.enum(['csv', 'xlsx', 'json']).optional(),
});

/** Validates and normalizes a full source definition. */
function validateDef(input: unknown): SourceDef {
  const def = parseOrThrow(sourceDefSchema, input) as SourceDef;
  if (def.kind === 'rest') {
    const cfg = parseOrThrow(restConfigSchema, def.config);
    parseJsonPath(cfg.itemsPath);
    if (cfg.cursorPath) parseJsonPath(cfg.cursorPath);
  } else if (def.kind === 'webhook') {
    const cfg = parseOrThrow(webhookConfigSchema, def.config);
    if (cfg.itemsPath) parseJsonPath(cfg.itemsPath);
  } else {
    parseOrThrow(fileConfigSchema, def.config);
  }
  validateMapping(def.mapping, def.qualityRules ?? []);
  return def;
}

function splitSecrets(def: SourceDef): {
  config: Record<string, unknown>;
  secretHeaders?: Record<string, string>;
} {
  const config = {...(def.config as Record<string, unknown>)};
  const secretHeaders = config.secretHeaders as
    Record<string, string> | undefined;
  delete config.secretHeaders;
  return {config, secretHeaders};
}

function toDef(s: SourceRecord): SourceDef {
  return {
    name: s.name,
    kind: s.kind,
    config: s.config as unknown as SourceDef['config'],
    mapping: s.mapping,
    qualityRules: s.qualityRules,
    conflictPolicy: s.conflictPolicy,
    priority: s.priority,
    ...(s.schedule ? {schedule: s.schedule} : {}),
    enabled: s.enabled,
  };
}

/** Lists the tenant's sources. */
export class ListSources {
  constructor(private readonly deps: AppDeps) {}
  async execute(ctx: CallCtx): Promise<SourceDto[]> {
    requireRole(ctx, 'Viewer');
    return (await this.deps.sources.list(ctx)).map(toSourceDto);
  }
}

/** Gets one source. */
export class GetSource {
  constructor(private readonly deps: AppDeps) {}
  async execute(ctx: CallCtx, id: string): Promise<SourceDto> {
    requireRole(ctx, 'Viewer');
    const s = await this.deps.sources.get(ctx, id);
    if (!s) throw new AppError('SOURCE_NOT_FOUND');
    return toSourceDto(s);
  }
}

/** Creates a source; webhook sources get a generated secret. */
export class CreateSource {
  constructor(private readonly deps: AppDeps) {}
  async execute(ctx: CallCtx, input: SourceDef): Promise<SourceDto> {
    requireRole(ctx, 'Modeler');
    const def = validateDef(input);
    const {config, secretHeaders} = splitSecrets(def);
    const secrets: SourceSecrets = {};
    if (def.kind === 'webhook') secrets.webhookSecret = randomToken(32);
    if (secretHeaders && Object.keys(secretHeaders).length > 0) {
      secrets.secretHeaders = secretHeaders;
    }
    const record: SourceRecord = {
      id: this.deps.newId(),
      tenantId: ctx.tenantId,
      name: def.name,
      kind: def.kind,
      config,
      secretEnc:
        Object.keys(secrets).length > 0
          ? await this.deps.cipher.seal(secrets)
          : null,
      mapping: def.mapping,
      qualityRules: def.qualityRules ?? [],
      conflictPolicy: def.conflictPolicy ?? 'latest-wins',
      priority: def.priority ?? 0,
      schedule: def.schedule ?? null,
      cursor: null,
      enabled: def.enabled ?? true,
      paused: false,
      lastJobAt: null,
      createdAt: this.deps.clock.now().getTime(),
    };
    await this.deps.sources.insert(record);
    const dto = toSourceDto(record);
    if (secrets.webhookSecret) dto.webhookSecret = secrets.webhookSecret;
    return dto;
  }
}

/** Updates a source (kind is immutable). */
export class UpdateSource {
  constructor(private readonly deps: AppDeps) {}
  async execute(
    ctx: CallCtx,
    id: string,
    patch: Partial<SourceDef>,
  ): Promise<SourceDto> {
    requireRole(ctx, 'Modeler');
    const current = await this.deps.sources.get(ctx, id);
    if (!current) throw new AppError('SOURCE_NOT_FOUND');
    if (patch.kind && patch.kind !== current.kind) {
      throw new AppError('VALIDATION_FAILED', 'Source kind cannot change');
    }
    const def = validateDef({...toDef(current), ...patch, kind: current.kind});
    const {config, secretHeaders} = splitSecrets(def);
    let secretEnc = current.secretEnc;
    if (secretHeaders !== undefined) {
      const secrets = current.secretEnc
        ? await this.deps.cipher.open(current.secretEnc)
        : {};
      if (Object.keys(secretHeaders).length > 0)
        secrets.secretHeaders = secretHeaders;
      else delete secrets.secretHeaders;
      secretEnc =
        Object.keys(secrets).length > 0
          ? await this.deps.cipher.seal(secrets)
          : null;
    }
    const updated: SourceRecord = {
      ...current,
      name: def.name,
      config,
      secretEnc,
      mapping: def.mapping,
      qualityRules: def.qualityRules ?? [],
      conflictPolicy: def.conflictPolicy ?? current.conflictPolicy,
      priority: def.priority ?? current.priority,
      schedule: def.schedule ?? null,
      enabled: def.enabled ?? current.enabled,
      // A Modeler touching the mapping (or re-enabling) confirms it.
      paused:
        patch.mapping !== undefined || patch.enabled === true
          ? false
          : current.paused,
    };
    await this.deps.sources.update(updated);
    return toSourceDto(updated);
  }
}

/** Deletes a source (its jobs are kept for audit). */
export class DeleteSource {
  constructor(private readonly deps: AppDeps) {}
  async execute(ctx: CallCtx, id: string): Promise<void> {
    requireRole(ctx, 'Modeler');
    if (!(await this.deps.sources.delete(ctx, id)))
      throw new AppError('SOURCE_NOT_FOUND');
  }
}

/** Pauses sources whose mapping targets (or links to) the given types. */
export class PauseSourcesForTypes {
  constructor(private readonly deps: AppDeps) {}
  async execute(
    ctx: CallCtx,
    objectTypes: string[],
  ): Promise<{paused: number}> {
    requireRole(ctx, 'Modeler');
    const types = new Set(objectTypes);
    if (types.size === 0) return {paused: 0};
    const ids = (await this.deps.sources.list(ctx))
      .filter(
        s =>
          !s.paused &&
          (types.has(s.mapping.targetType) ||
            (s.mapping.links ?? []).some(l => types.has(l.toType))),
      )
      .map(s => s.id);
    const paused =
      ids.length > 0 ? await this.deps.sources.setPaused(ctx, ids, true) : 0;
    if (paused > 0) {
      this.deps.logger.warn('sources paused after breaking change', {
        tenantId: ctx.tenantId,
        paused,
      });
    }
    return {paused};
  }
}
