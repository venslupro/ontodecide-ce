/**
 * @fileoverview TenantLifecycle entry point of ontology-manager (bound only
 * to identity-access). Validates the arguments and delegates.
 */

import {AppError, type TenantLifecycleRpc} from '@ontodecide/shared-kernel';

function checkTid(tid: unknown): asserts tid is string {
  if (typeof tid !== 'string' || tid === '') {
    throw new AppError('VALIDATION_FAILED', 'tenantId is required');
  }
}

/** Wraps the lifecycle use cases with argument checks. */
export function createTenantLifecycle(
  impl: TenantLifecycleRpc,
): TenantLifecycleRpc {
  return {
    exportTenant(tenantId, cursor) {
      checkTid(tenantId);
      return impl.exportTenant(tenantId, cursor);
    },
    purgeTenant(tenantId, maxRows) {
      checkTid(tenantId);
      return impl.purgeTenant(tenantId, maxRows);
    },
    countTenant(tenantId) {
      checkTid(tenantId);
      return impl.countTenant(tenantId);
    },
  };
}
