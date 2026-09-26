/**
 * @fileoverview SaveDraft use case.
 */

import {AppError, parseOrThrow, type CallCtx} from '@ontodecide/shared-kernel';
import {
  schemaDefSchema,
  type DraftDto,
  type SchemaDef,
  type ValidationIssue,
} from '../contract';
import {
  checkCrossSchemaConflicts,
  schemaNames,
  validateSchema,
} from '../domain';
import {DRAFT_VERSION, type OntologyDeps} from './ports';
import {iso, otherDefinitions} from './support';

/** Parses a definition with the contract zod schema (VALIDATION_FAILED on mismatch). */
export function parseSchemaDef(api: string, input: unknown): SchemaDef {
  const def = parseOrThrow(schemaDefSchema, input) as SchemaDef;
  if (def.apiName !== api) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Definition apiName ${def.apiName} does not match ${api}`,
      {
        errors: [
          {path: 'apiName', message: 'Must match the schema in the path'},
        ],
      },
    );
  }
  return def;
}

/** Structural plus cross-schema issues of a definition. */
export function schemaIssues(
  def: SchemaDef,
  others: readonly SchemaDef[],
): ValidationIssue[] {
  return [
    ...validateSchema(def),
    ...checkCrossSchemaConflicts(def, others.map(schemaNames)),
  ];
}

/**
 * Saves (creates or replaces) a draft. Input that does not match the zod
 * contract is rejected; structurally invalid drafts are saved and their
 * issues returned so the modeler can keep working.
 */
export class SaveDraftHandler {
  constructor(private readonly deps: OntologyDeps) {}

  async execute(
    ctx: CallCtx,
    api: string,
    input: SchemaDef,
  ): Promise<DraftDto> {
    const def = parseSchemaDef(api, input);
    const current = await this.deps.repo.listCurrent(ctx.tenantId);
    const validation = schemaIssues(def, otherDefinitions(current, api));
    const now = this.deps.clock.now().getTime();
    await this.deps.repo.saveDraft(ctx.tenantId, def, now);
    return {
      apiName: api,
      version: DRAFT_VERSION,
      savedAt: iso(now),
      validation,
    };
  }
}
