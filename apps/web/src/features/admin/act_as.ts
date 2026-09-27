/**
 * @fileoverview Admin view (Act-as-Tenant, 前端详细设计 6.3.1 / 6.3.7):
 * entering sets the target, which makes the API client add
 * `X-Act-As-Tenant` to every REST request and the realtime stream fetch a
 * ticket for the target; business caches are cleared on enter and exit so
 * two workspaces' data never mix. The backend writes the audit entries.
 */

import type {QueryClient} from '@tanstack/react-query';
import {useSession, type ActAsTarget} from '../../entities/session/store';
import {BUSINESS_PREFIXES} from '../../shared/api/query_keys';
import {releaseAll} from '../../shared/ws/stream';

/** Removes every business query (not `me` / `admin`). */
export function clearBusinessCaches(qc: QueryClient): void {
  for (const p of BUSINESS_PREFIXES) qc.removeQueries({queryKey: [p]});
}

/** Enters the admin view of `target`. */
export function enterActAs(qc: QueryClient, target: ActAsTarget): void {
  releaseAll();
  clearBusinessCaches(qc);
  useSession.getState().setActAs(target);
}

/** Leaves the admin view (back to the admin's own workspace). */
export function exitActAs(qc: QueryClient): void {
  if (!useSession.getState().actAs) return;
  releaseAll();
  clearBusinessCaches(qc);
  useSession.getState().setActAs(undefined);
}
