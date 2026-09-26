/**
 * @fileoverview Unit tests for the User aggregate and lock policy.
 */

import {describe, expect, it} from 'vitest';
import {checkAdminChange} from './admin_guard';
import {LOCK_DURATION_MS, MAX_FAILED_ATTEMPTS} from './lock_policy';
import {User} from './user';

const T0 = Date.parse('2026-09-24T00:00:00Z');

function newUser(overrides: Partial<Parameters<typeof User.create>[0]> = {}) {
  return User.create({
    id: 'u1',
    tenantId: 't1',
    email: ' Alice@Example.COM ',
    name: ' Alice ',
    role: 'Admin',
    markings: ['pii', 'finance', 'pii'],
    pwdHash: 'h',
    pwdSalt: 's',
    mustChangePassword: false,
    now: T0,
    ...overrides,
  });
}

describe('User', () => {
  it('normalizes email, name and markings', () => {
    const u = newUser();
    expect(u.email).toBe('alice@example.com');
    expect(u.name).toBe('Alice');
    expect(u.markings).toEqual(['finance', 'pii']);
    expect(u.locale).toBe('zh-CN');
  });

  it('locks after 5 consecutive failures for 15 minutes', () => {
    const u = newUser();
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) {
      expect(u.recordLoginFailure(T0 + i)).toBe(false);
      expect(u.isLocked(T0 + i)).toBe(false);
    }
    expect(u.recordLoginFailure(T0 + 10)).toBe(true);
    expect(u.isLocked(T0 + 10)).toBe(true);
    expect(u.isLocked(T0 + 10 + LOCK_DURATION_MS - 1)).toBe(true);
    expect(u.isLocked(T0 + 10 + LOCK_DURATION_MS)).toBe(false);
  });

  it('resets the failure counter on success', () => {
    const u = newUser();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) u.recordLoginFailure(T0);
    u.recordLoginSuccess(T0 + 1);
    expect(u.failedAttempts).toBe(0);
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) u.recordLoginFailure(T0);
    expect(u.isLocked(T0)).toBe(false);
    expect(u.state.lastLoginAt).toBe(T0 + 1);
  });

  it('starts a fresh window once a lock expires', () => {
    const u = newUser();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) u.recordLoginFailure(T0);
    const later = T0 + LOCK_DURATION_MS + 1;
    expect(u.recordLoginFailure(later)).toBe(false);
    expect(u.failedAttempts).toBe(1);
    expect(u.isLocked(later)).toBe(false);
  });

  it('admin password reset forces a change and clears the lock', () => {
    const u = newUser();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) u.recordLoginFailure(T0);
    u.setPassword('h2', 's2', true, T0 + 1);
    expect(u.mustChangePassword).toBe(true);
    expect(u.isLocked(T0 + 1)).toBe(false);
    u.setPassword('h3', 's3', false, T0 + 2);
    expect(u.mustChangePassword).toBe(false);
  });

  it('changes role and markings and returns the previous values', () => {
    const u = newUser();
    expect(u.changeRole('Viewer', T0 + 1)).toBe('Admin');
    expect(u.role).toBe('Viewer');
    expect(u.setMarkings(['b', 'a'], T0 + 2)).toEqual(['finance', 'pii']);
    expect(u.markings).toEqual(['a', 'b']);
    expect(u.state.updatedAt).toBe(T0 + 2);
  });

  it('restore copies state defensively', () => {
    const u = newUser();
    const copy = User.restore(u.state);
    copy.setMarkings(['x'], T0);
    expect(u.markings).toEqual(['finance', 'pii']);
  });
});

describe('checkAdminChange', () => {
  const admin = newUser({id: 'a1'});
  const other = newUser({id: 'a2'});
  const viewer = newUser({id: 'v1', role: 'Viewer'});

  it('refuses self delete / demote / disable', () => {
    for (const change of [
      {delete: true},
      {role: 'Viewer' as const},
      {disabled: true},
    ]) {
      expect(
        checkAdminChange({
          actorId: 'a1',
          target: admin,
          change,
          activeAdmins: 3,
        }),
      ).toBe('SELF_CHANGE');
    }
    expect(
      checkAdminChange({
        actorId: 'a1',
        target: admin,
        change: {role: 'Admin'},
        activeAdmins: 1,
      }),
    ).toBeNull();
  });

  it('refuses removing the last active Admin', () => {
    expect(
      checkAdminChange({
        actorId: 'a1',
        target: other,
        change: {delete: true},
        activeAdmins: 1,
      }),
    ).toBe('LAST_ADMIN');
    expect(
      checkAdminChange({
        actorId: 'a1',
        target: other,
        change: {delete: true},
        activeAdmins: 2,
      }),
    ).toBeNull();
    expect(
      checkAdminChange({
        actorId: 'a1',
        target: viewer,
        change: {delete: true},
        activeAdmins: 1,
      }),
    ).toBeNull();
  });
});
