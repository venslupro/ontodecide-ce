/**
 * @fileoverview Use cases reading the workspace ontology: the whole
 * ontology for the workbench, definition collections and single
 * definitions. A purged (tombstoned) workspace reads as empty.
 */

import {AppError, type CallCtx} from '@ontodecide/shared-kernel';
import type {
  DefinitionList,
  DefinitionResult,
  DefKind,
  OntologyDto,
  TemplateSeeds,
} from '../contract';
import {findDef, findTemplate, listOf} from '../domain';
import type {OntologyDeps} from './ports';
import {resolve} from './support';

/** Whole ontology of the workspace. */
export async function getOntology(
  deps: OntologyDeps,
  ctx: CallCtx,
): Promise<OntologyDto> {
  const r = resolve(await deps.schemas(ctx.tid).load());
  return {
    templateId: r.template.id,
    templateVersion: r.row?.templateVersion ?? r.template.version,
    custom: r.custom,
    etag: r.etag,
    definition: r.definition,
    updatedAt: r.row ? new Date(r.row.updatedAt).toISOString() : null,
  };
}

/** Definitions of one kind with the schema etag. */
export async function listDefinitions<K extends DefKind>(
  deps: OntologyDeps,
  ctx: CallCtx,
  kind: K,
): Promise<DefinitionList<K>> {
  const r = resolve(await deps.schemas(ctx.tid).load());
  return {items: listOf(r.definition, kind), etag: r.etag, custom: r.custom};
}

/** One definition; NOT_FOUND when absent. */
export async function getDefinition<K extends DefKind>(
  deps: OntologyDeps,
  ctx: CallCtx,
  kind: K,
  id: string,
): Promise<DefinitionResult<K>> {
  const r = resolve(await deps.schemas(ctx.tid).load());
  const item = findDef(r.definition, kind, id);
  if (!item) throw new AppError('NOT_FOUND', `${kind}/${id} not found`);
  return {item, etag: r.etag};
}

/** KPI and automation seeds of a built-in template. */
export function getTemplateSeeds(templateId: string): TemplateSeeds {
  const template = findTemplate(templateId);
  if (!template) {
    throw new AppError('NOT_FOUND', `Unknown template: ${templateId}`);
  }
  return structuredClone(template.seeds);
}
