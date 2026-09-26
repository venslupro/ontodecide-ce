/**
 * @fileoverview GetCompiledSchema use case (memory → KV → D1).
 */

import type {CallCtx} from '@ontodecide/shared-kernel';
import type {CompiledSchema} from '../contract';
import {compileSchema} from '../domain';
import {DRAFT_VERSION, type OntologyDeps} from './ports';
import {compiledOf, resolveVersion, schemaNotFound} from './support';

/** Returns a compiled schema; drafts are compiled on the fly (never cached). */
export class GetCompiledSchemaHandler {
  constructor(private readonly deps: OntologyDeps) {}

  async execute(
    ctx: CallCtx,
    api: string,
    version?: string,
  ): Promise<CompiledSchema> {
    const v = resolveVersion(version);
    const {repo, cache} = this.deps;
    if (v === DRAFT_VERSION) {
      const draft = await repo.getDraft(ctx.tenantId, api);
      if (!draft) schemaNotFound(api, v);
      return compileSchema(draft.definition, DRAFT_VERSION);
    }
    const cached = await cache.getSchema(ctx.tenantId, api, v);
    if (cached) return cached;
    const record =
      v === 'current'
        ? await repo.getCurrent(ctx.tenantId, api)
        : await repo.getVersion(ctx.tenantId, api, v);
    if (!record) schemaNotFound(api, v);
    const compiled = await compiledOf(record);
    cache.putSchema(ctx.tenantId, v, compiled);
    if (v === 'current')
      cache.putSchema(ctx.tenantId, compiled.version, compiled);
    return compiled;
  }
}
