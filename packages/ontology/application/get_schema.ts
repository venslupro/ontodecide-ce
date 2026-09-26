/**
 * @fileoverview GetSchema use case.
 */

import type {CallCtx} from '@ontodecide/shared-kernel';
import type {SchemaDto} from '../contract';
import {DRAFT_VERSION, type OntologyDeps} from './ports';
import {resolveVersion, schemaNotFound, toSchemaDto} from './support';

/** Returns one stored version: `current` (default), `draft` or a semver. */
export class GetSchemaHandler {
  constructor(private readonly deps: OntologyDeps) {}

  async execute(
    ctx: CallCtx,
    api: string,
    version?: string,
  ): Promise<SchemaDto> {
    const v = resolveVersion(version);
    const {repo} = this.deps;
    const record =
      v === 'current'
        ? await repo.getCurrent(ctx.tenantId, api)
        : v === DRAFT_VERSION
          ? await repo.getDraft(ctx.tenantId, api)
          : await repo.getVersion(ctx.tenantId, api, v);
    if (!record) schemaNotFound(api, v);
    return toSchemaDto(record);
  }
}
