/**
 * @fileoverview User aggregate: identity, role, markings, password state and
 * the login lock policy. Pure TS; persistence maps {@link UserState}.
 */

import type {Role} from '@ontodecide/shared-kernel';
import {applyFailure, applySuccess, isLocked} from './lock_policy';

/** Default UI locale of new users. */
export const DEFAULT_LOCALE = 'zh-CN';

/** Persistent state of a user. Times are epoch ms. */
export interface UserState {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  pwdHash: string;
  pwdSalt: string;
  role: Role;
  markings: string[];
  locale: string;
  disabled: boolean;
  mustChangePassword: boolean;
  failedAttempts: number;
  lockedUntil: number | null;
  lastLoginAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** Input to {@link User.create}. */
export interface NewUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: Role;
  markings?: string[];
  locale?: string;
  pwdHash: string;
  pwdSalt: string;
  mustChangePassword: boolean;
  now: number;
}

/** Lowercases and trims an email address. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Deduplicates, trims and sorts markings. */
export function normalizeMarkings(markings: readonly string[]): string[] {
  return [...new Set(markings.map(m => m.trim()).filter(Boolean))].sort();
}

/** The user aggregate. */
export class User {
  private constructor(private s: UserState) {}

  /** Creates a new user. */
  static create(input: NewUser): User {
    return new User({
      id: input.id,
      tenantId: input.tenantId,
      email: normalizeEmail(input.email),
      name: input.name.trim(),
      pwdHash: input.pwdHash,
      pwdSalt: input.pwdSalt,
      role: input.role,
      markings: normalizeMarkings(input.markings ?? []),
      locale: input.locale ?? DEFAULT_LOCALE,
      disabled: false,
      mustChangePassword: input.mustChangePassword,
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  /** Rehydrates a user from persistence. */
  static restore(state: UserState): User {
    return new User({...state, markings: [...state.markings]});
  }

  /** A copy of the current state (for persistence). */
  get state(): Readonly<UserState> {
    return {...this.s, markings: [...this.s.markings]};
  }

  get id(): string {
    return this.s.id;
  }
  get tenantId(): string {
    return this.s.tenantId;
  }
  get email(): string {
    return this.s.email;
  }
  get name(): string {
    return this.s.name;
  }
  get role(): Role {
    return this.s.role;
  }
  get markings(): string[] {
    return [...this.s.markings];
  }
  get locale(): string {
    return this.s.locale;
  }
  get disabled(): boolean {
    return this.s.disabled;
  }
  get mustChangePassword(): boolean {
    return this.s.mustChangePassword;
  }
  get pwdHash(): string {
    return this.s.pwdHash;
  }
  get pwdSalt(): string {
    return this.s.pwdSalt;
  }
  get failedAttempts(): number {
    return this.s.failedAttempts;
  }
  get lockedUntil(): number | null {
    return this.s.lockedUntil;
  }

  /** Whether the user is an enabled Admin. */
  get isActiveAdmin(): boolean {
    return this.s.role === 'Admin' && !this.s.disabled;
  }

  /** Whether login is currently locked. */
  isLocked(now: number): boolean {
    return isLocked(this.s, now);
  }

  /**
   * Records a failed login attempt. Returns true when this failure locked
   * the account.
   */
  recordLoginFailure(now: number): boolean {
    const wasLocked = this.isLocked(now);
    const next = applyFailure(this.s, now);
    this.s.failedAttempts = next.failedAttempts;
    this.s.lockedUntil = next.lockedUntil;
    this.touch(now);
    return !wasLocked && this.isLocked(now);
  }

  /** Records a successful login: resets the lock policy. */
  recordLoginSuccess(now: number): void {
    const next = applySuccess();
    this.s.failedAttempts = next.failedAttempts;
    this.s.lockedUntil = next.lockedUntil;
    this.s.lastLoginAt = now;
    this.touch(now);
  }

  /** Renames the user. */
  rename(name: string, now: number): void {
    this.s.name = name.trim();
    this.touch(now);
  }

  /** Changes the UI locale. */
  changeLocale(locale: string, now: number): void {
    this.s.locale = locale;
    this.touch(now);
  }

  /** Changes the role; returns the previous role. */
  changeRole(role: Role, now: number): Role {
    const prev = this.s.role;
    this.s.role = role;
    this.touch(now);
    return prev;
  }

  /** Replaces the markings; returns the previous markings. */
  setMarkings(markings: readonly string[], now: number): string[] {
    const prev = [...this.s.markings];
    this.s.markings = normalizeMarkings(markings);
    this.touch(now);
    return prev;
  }

  /** Disables the account. */
  disable(now: number): void {
    this.s.disabled = true;
    this.touch(now);
  }

  /** Re-enables the account (also clears any login lock). */
  enable(now: number): void {
    this.s.disabled = false;
    const next = applySuccess();
    this.s.failedAttempts = next.failedAttempts;
    this.s.lockedUntil = next.lockedUntil;
    this.touch(now);
  }

  /**
   * Sets a new password hash. An admin reset passes `mustChange = true` and
   * also clears the login lock.
   */
  setPassword(
    pwdHash: string,
    pwdSalt: string,
    mustChange: boolean,
    now: number,
  ): void {
    this.s.pwdHash = pwdHash;
    this.s.pwdSalt = pwdSalt;
    this.s.mustChangePassword = mustChange;
    if (mustChange) {
      const next = applySuccess();
      this.s.failedAttempts = next.failedAttempts;
      this.s.lockedUntil = next.lockedUntil;
    }
    this.touch(now);
  }

  private touch(now: number): void {
    this.s.updatedAt = now;
  }
}
