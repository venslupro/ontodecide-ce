/**
 * @fileoverview MSW handlers for the `/api/v1` gateway, built from contract
 * types and backed by resettable in-memory state. Platform endpoints live
 * in handlers/platform.ts, business endpoints in handlers/business.ts.
 * Tests override individual endpoints with `server.use(...)`.
 */

import {businessHandlers, resetBusinessDb} from './handlers/business';
import {platformHandlers, resetPlatformDb} from './handlers/platform';

export {API, problem} from './handlers/problem';

/** Default handlers. */
export const handlers = [...platformHandlers, ...businessHandlers];

/** Resets every in-memory db. */
export function resetDb(): void {
  resetPlatformDb();
  resetBusinessDb();
}
