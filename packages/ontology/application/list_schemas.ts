/**
 * @fileoverview ListSchemas use case.
 */

import type {CallCtx} from '@ontodecide/shared-kernel';
import type {SchemaSummary} from '../contract';
import {maxSemver} from '../domain';
import {DRAFT_VERSION, type OntologyDeps} from './ports';
import {iso} from './support';

/** Lists the tenant's schemas with their current version and draft flag. */
export class ListSchemasHandler {
  constructor(private readonly deps: OntologyDeps) {}

  async execute(ctx: CallCtx): Promise<SchemaSummary[]> {
    const rows = await this.deps.repo.listVersions(ctx.tenantId);
    const byApi = new Map<string, {published: string[]; hasDraft: boolean}>();
    for (const r of rows) {
      const e = byApi.get(r.apiName) ?? {published: [], hasDraft: false};
      if (r.status === 'PUBLISHED') e.published.push(r.version);
      else if (r.version === DRAFT_VERSION) e.hasDraft = true;
      byApi.set(r.apiName, e);
    }
    const keys = [...byApi].map(([apiName, e]) => ({
      apiName,
      version: maxSemver(e.published) ?? DRAFT_VERSION,
    }));
    const records = await this.deps.repo.getMany(ctx.tenantId, keys);
    return records
      .map(r => {
        const current = r.status === 'PUBLISHED' ? r.version : null;
        return {
          apiName: r.apiName,
          displayName: r.definition.displayName,
          currentVersion: current,
          hasDraft: byApi.get(r.apiName)?.hasDraft ?? false,
          objectTypeCount: r.definition.objectTypes.length,
          ...(current && r.publishedAt !== null
            ? {publishedAt: iso(r.publishedAt)}
            : {}),
        };
      })
      .sort((a, b) =>
        a.apiName < b.apiName ? -1 : a.apiName > b.apiName ? 1 : 0,
      );
  }
}
