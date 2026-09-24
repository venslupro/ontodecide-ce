/**
 * @fileoverview Unit tests for refresh token rotation rules and the
 * password policy.
 */

import {describe, expect, it} from 'vitest';
import {generateTemporaryPassword, isPasswordValid} from './password_policy';
import {
  REFRESH_TOKEN_TTL_MS,
  decideRefresh,
  newRefreshRecord,
} from './refresh_token';

const T0 = 1_000_000;

describe('decideRefresh', () => {
  const rec = newRefreshRecord({
    tokenHash: 'h',
    userId: 'u',
    tenantId: 't',
    family: 'f',
    now: T0,
  });

  it('rotates a fresh token', () => {
    expect(rec.expiresAt).toBe(T0 + REFRESH_TOKEN_TTL_MS);
    expect(decideRefresh(rec, T0 + 1)).toEqual({kind: 'rotate'});
  });

  it('rejects an expired token', () => {
    expect(decideRefresh(rec, T0 + REFRESH_TOKEN_TTL_MS)).toEqual({
      kind: 'reject',
      reason: 'expired',
    });
  });

  it('revokes the family when a rotated or revoked token is replayed', () => {
    expect(decideRefresh({...rec, rotated: true}, T0 + 1).kind).toBe(
      'revokeFamily',
    );
    expect(decideRefresh({...rec, revoked: true}, T0 + 1).kind).toBe(
      'revokeFamily',
    );
    // Replay wins over expiry.
    expect(
      decideRefresh({...rec, rotated: true}, T0 + REFRESH_TOKEN_TTL_MS).kind,
    ).toBe('revokeFamily');
  });
});

describe('password policy', () => {
  it('validates length and character classes', () => {
    expect(isPasswordValid('Abcdefghi1')).toBe(true);
    expect(isPasswordValid('Abcdefgh1')).toBe(false);
    expect(isPasswordValid('abcdefghij1')).toBe(false);
    expect(isPasswordValid('ABCDEFGHIJ1')).toBe(false);
    expect(isPasswordValid('Abcdefghijk')).toBe(false);
  });

  it('generates compliant temporary passwords', () => {
    const rnd = (n: number) => crypto.getRandomValues(new Uint8Array(n));
    for (let i = 0; i < 200; i++) {
      const pw = generateTemporaryPassword(rnd);
      expect(pw).toHaveLength(16);
      expect(isPasswordValid(pw)).toBe(true);
    }
    // Even a degenerate random source produces a valid password.
    expect(
      isPasswordValid(generateTemporaryPassword(n => new Uint8Array(n))),
    ).toBe(true);
  });
});
