/**
 * @fileoverview TenantLifecycle of ontology-manager (详细设计 6.11.1,
 * 6.11.6): export `ontology.json` (the custom definition, or only the
 * template id and version when the workspace never changed it), purge the
 * copy and write the local tombstone, count the rows held.
 */

import type {
  Clock,
  ExportPage,
  PurgeResult,
  TenantLifecycleRpc,
} from '@ontodecide/shared-kernel';
import type {LifecycleStore} from './ports';
import {resolve} from './support';

/** Dependencies of the lifecycle entry point. */
export interface LifecycleDeps {
  store: LifecycleStore;
  clock: Clock;
}

/** Creates the TenantLifecycle implementation. */
export function createOntologyLifecycle(
  deps: LifecycleDeps,
): TenantLifecycleRpc {
  return {
    async exportTenant(tenantId: string): Promise<ExportPage> {
      const r = resolve(await deps.store.load(tenantId));
      const doc = r.row
        ? {
            templateId: r.row.templateId,
            templateVersion: r.row.templateVersion,
            etag: r.row.etag,
            updatedAt: new Date(r.row.updatedAt).toISOString(),
            definition: r.row.definition,
          }
        : {templateId: r.template.id, templateVersion: r.template.version};
      return {
        file: 'ontology.json',
        text: JSON.stringify(doc),
        nextCursor: null,
      };
    },

    async purgeTenant(tenantId: string): Promise<PurgeResult> {
      // The service holds at most one row per workspace, which fits any
      // step budget: delete it and write the tombstone in the same batch.
      const deleted = await deps.store.purge(
        tenantId,
        deps.clock.now().getTime(),
      );
      return {deleted, done: true};
    },

    countTenant(tenantId: string): Promise<number> {
      return deps.store.count(tenantId);
    },
  };
}
