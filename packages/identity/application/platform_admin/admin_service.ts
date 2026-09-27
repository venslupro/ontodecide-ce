/**
 * @fileoverview PlatformAdmin use cases (修订说明书 6.4, 10.2): overview,
 * accounts, archives, settings, blocklists. Every method requires an admin
 * ctx; high-risk writes verify a step-up token; every write takes an
 * Idempotency-Key and is written to the audit chain. The bootstrap admin
 * itself can never be the target of a write (FORBIDDEN; triggers back it up).
 */

import {
  AppError,
  parseOrThrow,
  clampLimit,
  decodeCursor,
  encodeCursor,
  utcDay,
  type CallCtx,
  type Clock,
  type PageRequest,
  type PageResult,
} from '@ontodecide/shared-kernel';
import {
  adminSettingsPatchSchema,
  adminUserPatchSchema,
  blockedDomainsSchema,
  type AdminUserDto,
  type AdminUserPatch,
  type AdminUserRow,
  type AdminUserStatus,
  type ArchiveIndexDto,
  type PlatformOverview,
  type PlatformSettings,
} from '../../contract';
import {
  ADMIN_LIST_STATUSES,
  ARCHIVE_CAPACITY,
  FREE_TIER_DAILY,
  auditKind,
  channelKeys,
  signupState,
  type AnalyticsMetric,
} from '../../domain';
import {ADMIN_LINK_TTL_S} from '../config';
import type {AccountService} from '../identity/account_service';
import type {PasskeyService} from '../identity/passkey_service';
import type {SessionService} from '../identity/session_service';
import type {TrialService} from '../tenancy/trial_service';
import type {
  AccountRecord,
  AdminListRow,
  AdminQueryRepository,
  ArchiveIndexRecord,
  ArchiveIndexRepository,
  LedgerRepository,
  LinkSigner,
  SettingsRepository,
  UsageCounter,
  WorkspaceRepository,
} from '../ports';
import type {Secrets} from '../secrets';
import type {AuditService} from './audit_service';

/** usage_counter keys of the hourly analytics snapshot. */
export const ANALYTICS_KEYS: Record<AnalyticsMetric, string> = {
  workers: 'analytics:workers',
  d1Writes: 'analytics:d1Writes',
  neurons: 'analytics:neurons',
  queues: 'analytics:queues',
};

/** usage_counter key holding the snapshot time (ms). */
export const ANALYTICS_AT_KEY = 'analytics:at';

/** Collaborators of {@link AdminService}. */
export interface AdminDeps {
  passkeys: PasskeyService;
  audit: AuditService;
  accounts: AccountService;
  sessions: SessionService;
  trials: TrialService;
  workspaces: WorkspaceRepository;
  ledgers: LedgerRepository;
  archives: ArchiveIndexRepository;
  queries: AdminQueryRepository;
  settings: SettingsRepository;
  usage: UsageCounter;
  signer: LinkSigner;
  secrets: Secrets;
  clock: Clock;
  purgeBacklogLimit: number;
  trialHours: number;
  archiveDays: number;
  resendDailyCap: number;
  brevoDailyCap: number;
}

function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

function toArchiveDto(r: ArchiveIndexRecord): ArchiveIndexDto {
  return {
    tenantId: r.tenantId,
    sizeBytes: r.sizeBytes,
    sha256: r.sha256,
    createdAt: new Date(r.createdAt).toISOString(),
    expiresAt: new Date(r.expiresAt).toISOString(),
  };
}

/** Platform administration. */
export class AdminService {
  constructor(private readonly d: AdminDeps) {}

  private now(): number {
    return this.d.clock.now().getTime();
  }

  private admin(ctx: CallCtx): Promise<AccountRecord> {
    return this.d.passkeys.requireAdmin(ctx);
  }

  /** A target owner account; the admin itself → FORBIDDEN. */
  private async target(uid: string): Promise<AccountRecord> {
    const a = await this.d.accounts.accounts.findById(uid);
    if (!a) throw new AppError('NOT_FOUND');
    if (a.role === 'admin') throw new AppError('FORBIDDEN', 'ADMIN_IMMUTABLE');
    return a;
  }

  // —— Overview ——

  /** GET /admin/overview. */
  async overview(ctx: CallCtx): Promise<PlatformOverview> {
    await this.admin(ctx);
    const now = new Date(this.now());
    const day = utcDay(now);
    const s = await this.d.settings.get();
    const [active, backlog, signups, closed, archives, recent] =
      await Promise.all([
        this.d.workspaces.countTrials(['ACTIVE']),
        this.d.workspaces.countTrials(['EXPIRED', 'ARCHIVING']),
        this.d.usage.read(day, 'signup'),
        this.d.usage.read(day, 'signup_closed'),
        this.d.archives.count(),
        this.d.queries.recentAudit(10),
      ]);
    const analyticsAt = await this.d.usage.read(day, ANALYTICS_AT_KEY);
    const metrics = Object.keys(FREE_TIER_DAILY) as AnalyticsMetric[];
    const values = await Promise.all(
      metrics.map(m => this.d.usage.read(day, ANALYTICS_KEYS[m])),
    );
    const resend = channelKeys('resend', now);
    const brevo = channelKeys('brevo', now);
    return {
      activeTrials: {used: active, limit: s.activeWorkspaceLimit},
      signupsToday: {used: signups, limit: s.signupDailyLimit},
      archives: {used: archives, limit: ARCHIVE_CAPACITY},
      purgeBacklog: {used: backlog, limit: this.d.purgeBacklogLimit},
      signup: {state: signupState(s.signupEnabled, closed >= 1)},
      freeQuota: [
        ...metrics.map((key, i) => ({
          key,
          used: values[i],
          limit: FREE_TIER_DAILY[key],
        })),
        {
          key: 'emailResend' as const,
          used: await this.d.usage.read(resend.day, resend.key),
          limit: this.d.resendDailyCap,
        },
        {
          key: 'emailBrevo' as const,
          used: await this.d.usage.read(brevo.day, brevo.key),
          limit: this.d.brevoDailyCap,
        },
      ],
      analyticsAt: analyticsAt > 0 ? new Date(analyticsAt).toISOString() : null,
      recentActions: recent.map(r => ({
        at: new Date(r.at).toISOString(),
        action: r.action,
        target: r.targetTenantId ?? r.targetUserId,
        kind: auditKind(r.action),
      })),
    };
  }

  // —— Users ——

  private async toRow(r: AdminListRow): Promise<AdminUserRow> {
    return {
      userId: r.userId,
      tenantId: r.tenantId,
      email: r.emailEnc ? await this.d.secrets.decryptEmail(r.emailEnc) : null,
      status: r.status as AdminUserStatus,
      trialExpiresAt: iso(r.trialExpiresAt),
      zipExpiresAt: iso(r.zipExpiresAt),
      sessions: r.sessions,
      banned: r.bannedAt !== null,
    };
  }

  /** GET /admin/users (owners and derived ARCHIVE_ONLY rows). */
  async listUsers(
    ctx: CallCtx,
    q: {status?: string},
    page: PageRequest,
  ): Promise<PageResult<AdminUserRow>> {
    await this.admin(ctx);
    const status = q.status ?? null;
    if (
      status !== null &&
      !(ADMIN_LIST_STATUSES as readonly string[]).includes(status)
    ) {
      throw new AppError('VALIDATION_FAILED', 'Unknown status');
    }
    const limit = clampLimit(page.limit);
    const cursor = decodeCursor<{t: string}>(page.cursor)?.t ?? null;
    const rows = await this.d.queries.listUsers(
      status,
      cursor,
      limit + 1,
      this.now(),
    );
    const items = await Promise.all(
      rows.slice(0, limit).map(r => this.toRow(r)),
    );
    return {
      items,
      nextCursor:
        rows.length > limit
          ? encodeCursor({t: items[items.length - 1].tenantId})
          : null,
    };
  }

  private async userDto(a: AccountRecord): Promise<AdminUserDto> {
    const [w, idx, led, sessions, email] = await Promise.all([
      this.d.workspaces.get(a.tenantId),
      this.d.archives.get(a.tenantId),
      this.d.ledgers.get(a.tenantId),
      this.d.sessions.countActive(a.userId),
      this.d.secrets.decryptEmail(a.emailEnc),
    ]);
    if (!w) throw new AppError('NOT_FOUND');
    return {
      userId: a.userId,
      tenantId: a.tenantId,
      email,
      status: w.status,
      trialExpiresAt: iso(w.trialExpiresAt),
      zipExpiresAt: idx ? iso(idx.expiresAt) : null,
      sessions,
      banned: a.bannedAt !== null,
      locale: a.locale,
      timeZone: a.timeZone,
      verifiedAt: new Date(a.verifiedAt).toISOString(),
      expiredAt: iso(w.expiredAt),
      archivePhase: led?.phase ?? null,
    };
  }

  /** GET /admin/users/{uid}: full e-mail, writes email.view. */
  async getUser(ctx: CallCtx, uid: string): Promise<AdminUserDto> {
    await this.admin(ctx);
    const a = await this.d.accounts.accounts.findById(uid);
    if (!a || a.role === 'admin') throw new AppError('NOT_FOUND');
    const dto = await this.userDto(a);
    await this.d.audit.append({
      action: 'email.view',
      targetTenantId: a.tenantId,
      targetUserId: a.userId,
    });
    return dto;
  }

  /** PATCH /admin/users/{uid}. */
  async patchUser(
    ctx: CallCtx,
    uid: string,
    raw: AdminUserPatch,
    stepUp: string,
    key: string,
  ): Promise<AdminUserDto> {
    await this.d.passkeys.verifyStepUp(ctx, stepUp);
    const patch = parseOrThrow(adminUserPatchSchema, raw);
    const a = await this.target(uid);
    return this.d.audit.idempotent(
      key,
      {
        action: 'user.patch',
        targetTenantId: a.tenantId,
        targetUserId: a.userId,
        reason: patch.reason,
      },
      async () => {
        const now = this.now();
        if (patch.trialExpiresAt !== undefined) {
          const at = Date.parse(patch.trialExpiresAt);
          if (at <= now) {
            await this.d.trials.endTrial(a.tenantId);
          } else if (
            !(await this.d.workspaces.setTrialExpiry(a.tenantId, at, now))
          ) {
            throw new AppError('CONFLICT', 'WORKSPACE_ARCHIVING');
          }
          // Tokens and cookies carry the old trial end: force a new sign-in.
          await this.d.sessions.revokeUser(a.userId);
        }
        if (patch.status === 'EXPIRED')
          await this.d.trials.endTrial(a.tenantId);
        if (patch.banned === true) {
          await this.d.accounts.accounts.setBanned(a.userId, now);
          await this.d.settings.blockEmail(a.emailHmac, now);
          await this.d.sessions.revokeUser(a.userId);
        } else if (patch.banned === false) {
          await this.d.accounts.accounts.setBanned(a.userId, null);
          await this.d.settings.unblockEmail(a.emailHmac);
        }
        const fresh = await this.d.accounts.accounts.findById(a.userId);
        return this.userDto(fresh ?? a);
      },
    );
  }

  /** DELETE /admin/users/{uid}/sessions. */
  async revokeSessions(
    ctx: CallCtx,
    uid: string,
    key: string,
  ): Promise<{revoked: number}> {
    await this.admin(ctx);
    const a = await this.target(uid);
    return this.d.audit.idempotent(
      key,
      {
        action: 'sessions.revoke',
        targetTenantId: a.tenantId,
        targetUserId: a.userId,
      },
      async () => ({revoked: await this.d.sessions.revokeUser(a.userId)}),
    );
  }

  /** DELETE /admin/users/{uid}?archive=: ends the trial and schedules deletion. */
  async deleteUser(
    ctx: CallCtx,
    uid: string,
    opts: {archive: boolean; reason: string},
    stepUp: string,
    key: string,
  ): Promise<void> {
    await this.d.passkeys.verifyStepUp(ctx, stepUp);
    const reason = typeof opts.reason === 'string' ? opts.reason.trim() : '';
    if (reason.length === 0 || reason.length > 500) {
      throw new AppError('VALIDATION_FAILED', 'Reason required', {
        extras: {errors: [{path: 'reason', message: 'Required (1-500 chars)'}]},
      });
    }
    const a = await this.target(uid);
    await this.d.audit.idempotent(
      key,
      {
        action: 'user.delete',
        targetTenantId: a.tenantId,
        targetUserId: a.userId,
        reason: `${opts.archive ? 'archive' : 'no_archive'}: ${reason}`,
      },
      async () => {
        const mode = opts.archive ? 'archive' : 'no_archive';
        if (!(await this.d.workspaces.setDeleteMode(a.tenantId, mode))) {
          throw new AppError('CONFLICT', 'WORKSPACE_ARCHIVING');
        }
        await this.d.trials.endTrial(a.tenantId);
        await this.d.sessions.revokeUser(a.userId);
        return null;
      },
    );
  }

  // —— Archives ——

  /** GET /admin/archives. */
  async listArchives(
    ctx: CallCtx,
    page: PageRequest,
  ): Promise<PageResult<ArchiveIndexDto>> {
    await this.admin(ctx);
    const limit = clampLimit(page.limit);
    const cursor = decodeCursor<{t: string}>(page.cursor)?.t ?? null;
    const rows = await this.d.archives.list(cursor, limit + 1);
    const items = rows.slice(0, limit);
    return {
      items: items.map(toArchiveDto),
      nextCursor:
        rows.length > limit
          ? encodeCursor({t: items[items.length - 1].tenantId})
          : null,
    };
  }

  private async archiveOf(tid: string): Promise<ArchiveIndexRecord> {
    const idx = await this.d.archives.get(tid);
    if (!idx) throw new AppError('NOT_FOUND');
    return idx;
  }

  /** POST /admin/archives/{tid}/download-link (15 min). */
  async archiveLink(
    ctx: CallCtx,
    tid: string,
    key: string,
  ): Promise<{url: string; expiresAt: string}> {
    await this.admin(ctx);
    const idx = await this.archiveOf(tid);
    return this.d.audit.idempotent(
      key,
      {action: 'archive.download', targetTenantId: tid},
      async () => ({
        url: await this.d.signer.presignGet(
          idx.objectKey,
          ADMIN_LINK_TTL_S,
          `attachment; filename="ontodecide-archive-${tid}.zip"`,
        ),
        expiresAt: new Date(this.now() + ADMIN_LINK_TTL_S * 1000).toISOString(),
      }),
    );
  }

  /** DELETE /admin/archives/{tid}. */
  async deleteArchive(
    ctx: CallCtx,
    tid: string,
    stepUp: string,
    key: string,
  ): Promise<void> {
    await this.d.passkeys.verifyStepUp(ctx, stepUp);
    const idx = await this.archiveOf(tid);
    await this.d.audit.idempotent(
      key,
      {action: 'archive.delete', targetTenantId: tid},
      async () => {
        await this.d.trials.finalDelete(idx);
        return null;
      },
    );
  }

  // —— Settings and blocklists ——

  private async settingsDto(): Promise<PlatformSettings> {
    const s = await this.d.settings.get();
    return {
      signupEnabled: s.signupEnabled,
      signupDailyLimit: s.signupDailyLimit,
      activeWorkspaceLimit: s.activeWorkspaceLimit,
      trialHours: this.d.trialHours,
      archiveDays: this.d.archiveDays,
      version: s.version,
    };
  }

  /** GET /admin/settings (version = max(updated_at)). */
  async getSettings(ctx: CallCtx): Promise<PlatformSettings> {
    await this.admin(ctx);
    return this.settingsDto();
  }

  /** PATCH /admin/settings (If-Match version). */
  async patchSettings(
    ctx: CallCtx,
    raw: Partial<
      Pick<
        PlatformSettings,
        'signupEnabled' | 'signupDailyLimit' | 'activeWorkspaceLimit'
      >
    >,
    ifMatch: number,
    stepUp: string,
    key: string,
  ): Promise<PlatformSettings> {
    await this.d.passkeys.verifyStepUp(ctx, stepUp);
    const patch = parseOrThrow(adminSettingsPatchSchema, raw);
    return this.d.audit.idempotent(
      key,
      {action: 'settings.update', reason: JSON.stringify(patch)},
      async () => {
        const current = await this.d.settings.get();
        if (current.version !== ifMatch)
          throw new AppError('PRECONDITION_FAILED');
        const next = Math.max(this.now(), current.version + 1);
        if (!(await this.d.settings.patch(patch, ifMatch, next))) {
          throw new AppError('PRECONDITION_FAILED');
        }
        return this.settingsDto();
      },
    );
  }

  /** GET /admin/blocked-domains. */
  async getBlockedDomains(ctx: CallCtx): Promise<string[]> {
    await this.admin(ctx);
    return this.d.settings.blockedDomains();
  }

  /** PUT /admin/blocked-domains (replace). */
  async putBlockedDomains(
    ctx: CallCtx,
    domains: string[],
    key: string,
  ): Promise<string[]> {
    await this.admin(ctx);
    const parsed = parseOrThrow(blockedDomainsSchema, {domains}).domains;
    const unique = [...new Set(parsed)].sort();
    return this.d.audit.idempotent(
      key,
      {action: 'domains.replace', reason: `${unique.length} domains`},
      async () => {
        await this.d.settings.replaceDomains(unique, this.now());
        return this.d.settings.blockedDomains();
      },
    );
  }
}
