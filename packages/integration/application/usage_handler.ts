/**
 * @fileoverview usage(ctx): the caller's daily import rows and AI mapping
 * drafts, merged by api-gateway into `GET /me`.quotas.
 */

import type {CallCtx, QuotaItem} from '@ontodecide/shared-kernel';
import {mappingAiRef} from './draft_handler';
import {importRowsRef} from './import_handlers';
import type {IntegrationDeps} from './ports';

/** importRowsToday and mappingDraftsToday of the caller. */
export async function usage(
  deps: IntegrationDeps,
  ctx: CallCtx,
): Promise<QuotaItem[]> {
  const now = deps.clock.now();
  const [rows, drafts] = await Promise.all([
    deps.usage.read(importRowsRef(ctx, now)),
    deps.usage.read(mappingAiRef(ctx, now)),
  ]);
  return [
    {key: 'importRowsToday', used: rows, limit: deps.config.importRowsDaily},
    {
      key: 'mappingDraftsToday',
      used: drafts,
      limit: deps.config.mappingAiDaily,
    },
  ];
}
