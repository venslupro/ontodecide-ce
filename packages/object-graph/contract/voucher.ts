/**
 * @fileoverview Approval voucher signing (decision-engine) and verification
 * (object-graph) with a shared APPROVAL_SECRET. Avoids a synchronous call
 * back from object-graph to decision-engine.
 */

import {constantTimeEqual, hmacSha256Hex} from '@ontodecide/shared-kernel';
import type {ApprovalVoucher} from './types';

function payload(v: Omit<ApprovalVoucher, 'signature'>): string {
  return [
    v.recommendationId,
    v.tenantId,
    v.actionType,
    v.target,
    v.expiresAt,
  ].join('|');
}

/** Signs a voucher. */
export async function signVoucher(
  secret: string,
  v: Omit<ApprovalVoucher, 'signature'>,
): Promise<ApprovalVoucher> {
  return {...v, signature: await hmacSha256Hex(secret, payload(v))};
}

/** Verifies signature and expiry. */
export async function verifyVoucher(
  secret: string,
  v: ApprovalVoucher,
  now: Date = new Date(),
): Promise<boolean> {
  if (new Date(v.expiresAt).getTime() < now.getTime()) return false;
  const expected = await hmacSha256Hex(secret, payload(v));
  return constantTimeEqual(expected, v.signature);
}
