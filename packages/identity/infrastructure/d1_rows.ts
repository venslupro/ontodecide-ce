/**
 * @fileoverview Row mapping helpers shared by the identity-access D1
 * repositories.
 */

import type {
  Locale,
  UserRole,
  WorkspaceStatus,
} from '@ontodecide/shared-kernel';
import type {AccountRecord, WorkspaceRecord} from '../application';

/** Raw user_account row. */
export interface AccountRow {
  user_id: string;
  tenant_id: string;
  role: string;
  email_hmac: string;
  email_enc: string;
  locale: string;
  time_zone: string;
  verified_at: number;
  reminded_at: number | null;
  banned_at: number | null;
}

/** Maps a user_account row. */
export function toAccount(r: AccountRow): AccountRecord {
  return {
    userId: r.user_id,
    tenantId: r.tenant_id,
    role: r.role as UserRole,
    emailHmac: r.email_hmac,
    emailEnc: r.email_enc,
    locale: r.locale as Locale,
    timeZone: r.time_zone,
    verifiedAt: r.verified_at,
    remindedAt: r.reminded_at,
    bannedAt: r.banned_at,
  };
}

/** Raw workspace row. */
export interface WorkspaceRow {
  tenant_id: string;
  kind: string;
  owner_user_id: string;
  status: string;
  trial_expires_at: number | null;
  expired_at: number | null;
  delete_mode: string | null;
  created_at: number;
}

/** Maps a workspace row. */
export function toWorkspace(r: WorkspaceRow): WorkspaceRecord {
  return {
    tenantId: r.tenant_id,
    kind: r.kind as WorkspaceRecord['kind'],
    ownerUserId: r.owner_user_id,
    status: r.status as WorkspaceStatus,
    trialExpiresAt: r.trial_expires_at,
    expiredAt: r.expired_at,
    deleteMode: r.delete_mode as WorkspaceRecord['deleteMode'],
    createdAt: r.created_at,
  };
}

/** Whether an error is a SQLite / D1 UNIQUE or PRIMARY KEY violation. */
export function isUniqueViolation(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /UNIQUE constraint failed|PRIMARY KEY/i.test(m);
}
