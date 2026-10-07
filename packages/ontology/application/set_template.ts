/**
 * @fileoverview Use case: replace the workspace ontology with a built-in
 * template. Used when loading an example scenario so the sample data's
 * object and link types exist. The first call copies the template;
 * subsequent calls overwrite the copy (the workspace's custom changes are
 * discarded — callers should only invoke this on an empty workspace).
 */

import {AppError, type CallCtx} from '@ontodecide/shared-kernel';
import type {OntologyDef} from '../contract';
import {compileOntology, findTemplate, validateOntology} from '../domain';
import type {OntologyDeps} from './ports';
import {resolve} from './support';

/** Replaces the workspace ontology with the template `templateId`. */
export async function setTemplate(
  deps: OntologyDeps,
  ctx: CallCtx,
  templateId: string,
): Promise<{etag: number}> {
  const template = findTemplate(templateId);
  if (!template) {
    throw new AppError('NOT_FOUND', `Unknown template: ${templateId}`);
  }
  const store = deps.schemas(ctx.tid);
  const current = resolve(await store.load());
  if (current.tombstoned) throw new AppError('NOT_FOUND', 'Workspace deleted');

  const next: OntologyDef = template.definition;
  const issues = validateOntology(next);
  if (issues.length) {
    throw new AppError('VALIDATION_FAILED', 'Invalid template ontology', {
      extras: {issues},
    });
  }
  const etag = current.etag + 1;
  const compiled = compileOntology(next, {
    templateId: template.id,
    templateVersion: template.version,
    custom: true,
    etag,
  });
  const write = {
    templateId: template.id,
    templateVersion: template.version,
    definition: next,
    compiled,
    updatedAt: deps.clock.now().getTime(),
  };
  const ok = current.row
    ? await store.update(write, current.etag)
    : await store.insertCopy(write);
  if (!ok) {
    throw new AppError(
      'PRECONDITION_FAILED',
      'Ontology was modified concurrently',
    );
  }
  deps.cache.set(ctx.tid, etag, compiled);
  deps.logger.info('ontology template set', {
    tid: ctx.tid,
    templateId: template.id,
    etag,
  });
  return {etag};
}
