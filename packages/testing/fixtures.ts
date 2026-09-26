/**
 * @fileoverview Common test fixtures.
 */

import type {CallCtx, Role} from '@ontodecide/shared-kernel';

/** Builds a CallCtx for tests. */
export function testCtx(
  overrides: Partial<CallCtx> & {role?: Role} = {},
): CallCtx {
  const {role, ...rest} = overrides;
  return {
    tenantId: 't1',
    userId: 'u1',
    roles: [role ?? 'Admin'],
    markings: [],
    requestId: 'req-1',
    correlationId: 'corr-1',
    ...rest,
  };
}
