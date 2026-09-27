/**
 * @fileoverview Identity: sessions and refresh-token families (修订说明书
 * 5.4, 12.3). Refresh tokens are 256-bit random values; only SHA-256 is
 * stored. Each refresh rotates the token; a rotated token presented again
 * revokes the whole family. ≤ MAX_SESSIONS per user (oldest evicted).
 */

import {
  AppError,
  randomToken,
  sha256Hex,
  ulid,
  type AuthMethod,
  type CallCtx,
  type Clock,
} from '@ontodecide/shared-kernel';
import type {IssuedSession, RefreshResult, RequestMeta} from '../../contract';
import {sessionExpiry, trialUsable} from '../../domain';
import type {WorkspaceDirectory} from '../tenancy/workspace_directory';
import type {AccountService} from './account_service';
import type {
  AccountRecord,
  SessionRecord,
  SessionRepository,
  WorkspaceRecord,
} from '../ports';
import type {TokenService} from '../tokens';

/** Session limits. */
export interface SessionLimits {
  trialHours: number;
  adminSessionHours: number;
  maxSessions: number;
}

/** Issues, rotates and revokes sessions. */
export class SessionService {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly accounts: AccountService,
    private readonly workspaces: WorkspaceDirectory,
    private readonly tokens: TokenService,
    private readonly clock: Clock,
    private readonly limits: SessionLimits,
  ) {}

  private now(): number {
    return this.clock.now().getTime();
  }

  private async accessToken(
    a: AccountRecord,
    w: WorkspaceRecord,
    sid: string,
    amr: AuthMethod[],
  ) {
    return this.tokens.access({
      sub: a.userId,
      role: a.role,
      tid: w.tenantId,
      st: w.status,
      ...(a.role === 'owner' && w.trialExpiresAt !== null
        ? {texp: Math.floor(w.trialExpiresAt / 1000)}
        : {}),
      sid,
      amr,
    });
  }

  /** Issues a new session (new family). */
  async issue(
    a: AccountRecord,
    w: WorkspaceRecord,
    amr: AuthMethod[],
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const now = this.now();
    const refreshToken = randomToken(32);
    const s: SessionRecord = {
      sessionId: ulid(now),
      userId: a.userId,
      familyId: ulid(now),
      refreshHash: await sha256Hex(refreshToken),
      amr,
      client: meta.client?.slice(0, 80) ?? null,
      createdAt: now,
      expiresAt: sessionExpiry({
        role: a.role,
        now,
        trialExpiresAt: w.trialExpiresAt,
        trialHours: this.limits.trialHours,
        adminSessionHours: this.limits.adminSessionHours,
      }),
    };
    await this.sessions.create(s, this.limits.maxSessions);
    const access = await this.accessToken(a, w, s.sessionId, amr);
    return {
      kind: 'session',
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken,
      refreshExpiresAt: s.expiresAt,
      amr,
      me: await this.accounts.me(a),
    };
  }

  /**
   * Rotates a refresh token. Re-reads the account and the workspace, so a
   * changed trial end is reflected at once; a non-ACTIVE trial →
   * TRIAL_EXPIRED; a replayed token revokes its family → UNAUTHENTICATED.
   */
  async refresh(
    refreshToken: string,
    _meta: RequestMeta,
  ): Promise<RefreshResult> {
    const now = this.now();
    const hash = await sha256Hex(refreshToken);
    const s = await this.sessions.findByHash(hash);
    if (!s) {
      const rotated = await this.sessions.findRotated(hash);
      if (rotated) await this.sessions.revokeFamily(rotated.familyId);
      throw new AppError('UNAUTHENTICATED', 'REFRESH_INVALID');
    }
    if (s.expiresAt <= now) {
      await this.sessions.delete(s.sessionId, s.userId);
      throw new AppError('UNAUTHENTICATED', 'SESSION_EXPIRED');
    }
    const a = await this.accounts.accounts.findById(s.userId);
    if (!a || a.bannedAt !== null) {
      await this.sessions.deleteByUser(s.userId);
      throw new AppError('UNAUTHENTICATED', 'ACCOUNT_UNAVAILABLE');
    }
    const w = await this.workspaces.get(a.tenantId);
    if (!w) throw new AppError('UNAUTHENTICATED', 'ACCOUNT_UNAVAILABLE');
    if (a.role === 'owner' && !trialUsable(w.status, w.trialExpiresAt, now)) {
      throw new AppError('TRIAL_EXPIRED');
    }
    const next = randomToken(32);
    const expiresAt =
      a.role === 'owner' && w.trialExpiresAt !== null
        ? Math.min(s.expiresAt, w.trialExpiresAt)
        : s.expiresAt;
    if (!(await this.sessions.rotate(s, await sha256Hex(next), expiresAt))) {
      // A concurrent refresh already rotated this token: treat as replay.
      await this.sessions.revokeFamily(s.familyId);
      throw new AppError('UNAUTHENTICATED', 'REFRESH_INVALID');
    }
    const access = await this.accessToken(a, w, s.sessionId, s.amr);
    return {
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: next,
      refreshExpiresAt: expiresAt,
    };
  }

  /** DELETE /auth/sessions/current. */
  async logout(ctx: CallCtx, sid: string): Promise<void> {
    await this.sessions.delete(sid, ctx.actor.userId ?? ctx.sub);
  }

  /** Whether an admin session is still valid (checked on every request). */
  async verifyAdmin(sid: string): Promise<boolean> {
    const s = await this.sessions.findById(sid);
    if (!s || s.expiresAt <= this.now()) return false;
    const a = await this.accounts.accounts.findById(s.userId);
    return !!a && a.role === 'admin' && a.bannedAt === null;
  }

  /** Active sessions of a user. */
  countActive(userId: string): Promise<number> {
    return this.sessions.countActive(userId, this.now());
  }

  /** Revokes every session of a user. */
  revokeUser(userId: string): Promise<number> {
    return this.sessions.deleteByUser(userId);
  }

  /**
   * Whether the admin holds a live session signed in with a recovery code
   * (read from D1, never from the caller): such a session may bind a new
   * passkey without a step-up.
   */
  recoverySessionActive(userId: string): Promise<boolean> {
    return this.sessions.hasActiveRecoverySession(userId, this.now());
  }
}
