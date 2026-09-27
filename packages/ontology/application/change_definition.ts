/**
 * @fileoverview Use cases changing the workspace ontology (详细设计 6.11.1):
 * If-Match check → copy the template if the workspace has no copy yet →
 * apply the change → structural validation → compile → conditional write
 * (`etag = etag + 1 WHERE tenant_id = ?1 AND etag = ?`). Any failure leaves
 * the stored ontology unchanged.
 */

import {AppError, type CallCtx} from '@ontodecide/shared-kernel';
import {defSchemas} from '../contract';
import type {
  DefByKind,
  DefKind,
  OntologyDef,
  ValidationIssue,
} from '../contract';
import {
  compileOntology,
  findDef,
  isDefKind,
  putDef,
  referencesTo,
  removeDef,
  validateOntology,
} from '../domain';
import type {OntologyDeps} from './ports';
import {resolve, type ResolvedOntology} from './support';

function invalid(issues: ValidationIssue[], detail = 'Invalid ontology') {
  return new AppError('VALIDATION_FAILED', detail, {extras: {issues}});
}

/** Checks kind and If-Match syntax. */
function checkArgs(kind: unknown, ifMatch: unknown): asserts kind is DefKind {
  if (!isDefKind(kind)) {
    throw invalid([{path: 'kind', message: `Unknown kind: ${String(kind)}`}]);
  }
  if (
    typeof ifMatch !== 'number' ||
    !Number.isInteger(ifMatch) ||
    ifMatch < 0
  ) {
    throw invalid([{path: 'ifMatch', message: 'If-Match must be a version'}]);
  }
}

/** Parses a definition body with the contract's zod schema. */
function parseDef<K extends DefKind>(
  kind: K,
  id: string,
  def: unknown,
): DefByKind[K] {
  const parsed = defSchemas[kind].safeParse(def);
  if (!parsed.success) {
    throw invalid(
      parsed.error.issues.map(i => ({
        path: i.path.map(String).join('.'),
        message: i.message,
      })),
    );
  }
  const item = parsed.data as unknown as DefByKind[K];
  if (item.apiName !== id) {
    throw invalid([
      {path: 'apiName', message: `apiName must equal the id (${id})`},
    ]);
  }
  return item;
}

function preconditionFailed(current: number): AppError {
  return new AppError('PRECONDITION_FAILED', 'Ontology was modified', {
    extras: {etag: current},
  });
}

async function load(deps: OntologyDeps, ctx: CallCtx, ifMatch: number) {
  const store = deps.schemas(ctx.tid);
  const current = resolve(await store.load());
  if (current.tombstoned) throw new AppError('NOT_FOUND', 'Workspace deleted');
  if (current.etag !== ifMatch) throw preconditionFailed(current.etag);
  return {store, current};
}

async function commit(
  deps: OntologyDeps,
  ctx: CallCtx,
  store: ReturnType<OntologyDeps['schemas']>,
  current: ResolvedOntology,
  next: OntologyDef,
  what: string,
): Promise<{etag: number}> {
  const issues = validateOntology(next);
  if (issues.length) throw invalid(issues);
  const templateId = current.row?.templateId ?? current.template.id;
  const templateVersion =
    current.row?.templateVersion ?? current.template.version;
  const etag = current.etag + 1;
  const compiled = compileOntology(next, {
    templateId,
    templateVersion,
    custom: true,
    etag,
  });
  const write = {
    templateId,
    templateVersion,
    definition: next,
    compiled,
    updatedAt: deps.clock.now().getTime(),
  };
  const ok = current.row
    ? await store.update(write, current.etag)
    : await store.insertCopy(write);
  if (!ok) throw preconditionFailed(current.etag);
  deps.cache.set(ctx.tid, etag, compiled);
  deps.logger.info('ontology changed', {
    tid: ctx.tid,
    etag,
    what,
    copied: current.row === null,
  });
  return {etag};
}

/** Creates or replaces a definition. */
export async function putDefinition<K extends DefKind>(
  deps: OntologyDeps,
  ctx: CallCtx,
  kind: K,
  id: string,
  def: DefByKind[K],
  ifMatch: number,
): Promise<{etag: number}> {
  checkArgs(kind, ifMatch);
  const item = parseDef(kind, id, def);
  const {store, current} = await load(deps, ctx, ifMatch);
  const next = putDef(current.definition, kind, id, item);
  return commit(deps, ctx, store, current, next, `put ${kind}`);
}

/** Removes a definition; rejected while other definitions reference it. */
export async function deleteDefinition(
  deps: OntologyDeps,
  ctx: CallCtx,
  kind: DefKind,
  id: string,
  ifMatch: number,
): Promise<{etag: number}> {
  checkArgs(kind, ifMatch);
  const {store, current} = await load(deps, ctx, ifMatch);
  if (!findDef(current.definition, kind, id)) {
    throw new AppError('NOT_FOUND', `${kind}/${id} not found`);
  }
  const refs = referencesTo(current.definition, kind, id);
  if (refs.length) throw invalid(refs, `${id} is still referenced`);
  const next = removeDef(current.definition, kind, id);
  return commit(deps, ctx, store, current, next, `delete ${kind}`);
}
