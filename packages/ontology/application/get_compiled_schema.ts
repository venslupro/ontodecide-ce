/**
 * @fileoverview Use case: compiled ontology of a workspace. Workspaces that
 * never changed their ontology share the template's compiled form; copies
 * are cached in isolate memory by (tid, etag), so a warm call costs one
 * small D1 read (tombstone + etag).
 */

import type {CallCtx} from '@ontodecide/shared-kernel';
import type {CompiledSchema} from '../contract';
import {DEFAULT_TEMPLATE} from '../domain';
import type {OntologyDeps} from './ports';
import {
  compiledOfRow,
  compiledTemplate,
  emptyCompiled,
  templateOf,
} from './support';

/** Returns the compiled ontology of `ctx.tid`. */
export async function getCompiledSchema(
  deps: OntologyDeps,
  ctx: CallCtx,
): Promise<CompiledSchema> {
  const store = deps.schemas(ctx.tid);
  const head = await store.head();
  if (head.tombstoned) return emptyCompiled(DEFAULT_TEMPLATE);
  if (head.etag === null) return compiledTemplate(DEFAULT_TEMPLATE);
  const cached = deps.cache.get(ctx.tid, head.etag);
  if (cached) return cached;
  const {row, tombstoned} = await store.load();
  if (tombstoned) return emptyCompiled(templateOf(row));
  if (!row) return compiledTemplate(DEFAULT_TEMPLATE);
  return compiledOfRow(ctx.tid, row, deps.cache);
}
