/**
 * @fileoverview Refresh token family rotation rules. Each login starts a
 * family; each refresh rotates the presented token (marks it rotated) and
 * issues a successor in the same family. Presenting a rotated or revoked
 * token is treated as theft and revokes the whole family.
 */

/** Refresh token lifetime (7 days). */
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 3600 * 1000;

/** A stored refresh token (only its hash is persisted). */
export interface RefreshTokenRecord {
  tokenHash: string;
  userId: string;
  tenantId: string;
  family: string;
  /** Epoch ms. */
  expiresAt: number;
  revoked: boolean;
  rotated: boolean;
  /** Epoch ms. */
  createdAt: number;
}

/** Outcome of presenting a refresh token. */
export type RefreshDecision =
  | {kind: 'rotate'}
  | {kind: 'reject'; reason: 'expired'}
  | {kind: 'revokeFamily'; reason: 'replay'};

/** Decides what to do with a presented (known) refresh token. */
export function decideRefresh(
  record: RefreshTokenRecord,
  now: number,
): RefreshDecision {
  if (record.rotated || record.revoked) {
    return {kind: 'revokeFamily', reason: 'replay'};
  }
  if (record.expiresAt <= now) return {kind: 'reject', reason: 'expired'};
  return {kind: 'rotate'};
}

/** Builds the record for a newly issued token. */
export function newRefreshRecord(input: {
  tokenHash: string;
  userId: string;
  tenantId: string;
  family: string;
  now: number;
}): RefreshTokenRecord {
  return {
    tokenHash: input.tokenHash,
    userId: input.userId,
    tenantId: input.tenantId,
    family: input.family,
    expiresAt: input.now + REFRESH_TOKEN_TTL_MS,
    revoked: false,
    rotated: false,
    createdAt: input.now,
  };
}
