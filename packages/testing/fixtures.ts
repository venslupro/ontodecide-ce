/**
 * @fileoverview Common test fixtures.
 */

import type {CallCtx, UserRole} from '@ontodecide/shared-kernel';

/** Default workspace and user ids used by tests (ULID-shaped). */
export const TEST_TID = '01K6A000000000000000000V01';
export const TEST_UID = '01K6A000000000000000000W01';

/** Builds a CallCtx for tests (an owner in {@link TEST_TID} by default). */
export function testCtx(
  overrides: Partial<CallCtx> & {role?: UserRole; actingAs?: boolean} = {},
): CallCtx {
  const {role, actingAs, ...rest} = overrides;
  return {
    tid: TEST_TID,
    sub: TEST_UID,
    actor: {role: role ?? 'owner', userId: TEST_UID, actingAs: !!actingAs},
    requestId: 'req-1',
    locale: 'zh-CN',
    ...rest,
  };
}
