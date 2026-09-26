/**
 * @fileoverview Invariants protecting tenant administration: an admin
 * cannot delete, demote or disable themselves, and a tenant always keeps at
 * least one active Admin.
 */

import type {Role} from '@ontodecide/shared-kernel';
import type {User} from './user';

/** A change an admin wants to apply to a user. */
export interface AdminChange {
  role?: Role;
  disabled?: boolean;
  delete?: boolean;
}

/** Why a change is refused. */
export type AdminGuardViolation = 'SELF_CHANGE' | 'LAST_ADMIN';

/** Whether the change removes the target's active-Admin status. */
export function removesActiveAdmin(target: User, change: AdminChange): boolean {
  if (!target.isActiveAdmin) return false;
  return (
    change.delete === true ||
    change.disabled === true ||
    (change.role !== undefined && change.role !== 'Admin')
  );
}

/**
 * Checks a change against the guards. `activeAdmins` is the number of
 * active Admins in the target's tenant (including the target).
 */
export function checkAdminChange(input: {
  actorId: string;
  target: User;
  change: AdminChange;
  activeAdmins: number;
}): AdminGuardViolation | null {
  const {actorId, target, change, activeAdmins} = input;
  const selfRemoval =
    change.delete === true ||
    change.disabled === true ||
    (change.role !== undefined && change.role !== 'Admin');
  if (target.id === actorId && selfRemoval) return 'SELF_CHANGE';
  if (removesActiveAdmin(target, change) && activeAdmins <= 1) {
    return 'LAST_ADMIN';
  }
  return null;
}
