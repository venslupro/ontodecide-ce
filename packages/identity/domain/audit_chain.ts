/**
 * @fileoverview The admin_audit hash chain (修订说明书 12.3): row_hash =
 * SHA-256(prev_hash ‖ canonical row content). Rows are append-only; the
 * oldest retained row anchors the chain after the 90-day retention cut.
 */

import {canonicalJson, sha256Hex} from '@ontodecide/shared-kernel';

/** prev_hash of the very first row. */
export const GENESIS_HASH = '0'.repeat(64);

/** Audit retention (days). */
export const AUDIT_RETENTION_DAYS = 90;

/** Actions written to admin_audit. */
export type AuditAction =
  | 'user.patch'
  | 'user.delete'
  | 'sessions.revoke'
  | 'act_as.enter'
  | 'tenant.write'
  | 'email.view'
  | 'archive.download'
  | 'archive.delete'
  | 'settings.update'
  | 'domains.replace'
  | 'passkey.add'
  | 'passkey.delete';

/** Hashed content of one row. */
export interface AuditRowContent {
  id: string;
  at: number;
  action: string;
  targetTenantId: string | null;
  targetUserId: string | null;
  reason: string | null;
  idempotencyKey: string | null;
  result: string | null;
}

/** A stored row. */
export interface AuditRow extends AuditRowContent {
  prevHash: string;
  rowHash: string;
}

/** Computes row_hash. */
export function computeRowHash(
  prevHash: string,
  row: AuditRowContent,
): Promise<string> {
  return sha256Hex(
    prevHash +
      canonicalJson({
        id: row.id,
        at: row.at,
        action: row.action,
        targetTenantId: row.targetTenantId,
        targetUserId: row.targetUserId,
        reason: row.reason,
        idempotencyKey: row.idempotencyKey,
        result: row.result,
      }),
  );
}

/**
 * Verifies rows in chain order (oldest first): each row hash recomputes
 * and each prev_hash equals the previous row's hash.
 */
export async function verifyChain(rows: readonly AuditRow[]): Promise<boolean> {
  let prev: string | null = null;
  for (const r of rows) {
    if (prev !== null && r.prevHash !== prev) return false;
    if ((await computeRowHash(r.prevHash, r)) !== r.rowHash) return false;
    prev = r.rowHash;
  }
  return true;
}

/** Overview category of an action. */
export function auditKind(
  action: string,
): 'modify' | 'delete' | 'enter' | 'view' {
  if (action === 'act_as.enter') return 'enter';
  if (action === 'email.view' || action === 'archive.download') return 'view';
  if (action.endsWith('.delete')) return 'delete';
  return 'modify';
}
