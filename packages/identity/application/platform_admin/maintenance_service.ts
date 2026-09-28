/**
 * @fileoverview PlatformAdmin maintenance run by the cron: controlled admin
 * changes written by the ops script `scripts/admin_pending_change.mjs`
 * (24 h cool-down, original address notified; a new e-mail arrives as
 * `{"emailEnc": AES-GCM(EMAIL_ENC_KEY, normalized e-mail)}`), the hourly
 * account-wide analytics check (≥ 80 % closes sign-up; a failed read keeps
 * the last snapshot), the B2 signing-key age check (every 12 ticks) and the
 * daily audit anchor in B2.
 */

import {
  DAY_MS,
  HOUR_MS,
  parseJson,
  utcDay,
  type Clock,
  type Logger,
} from '@ontodecide/shared-kernel';
import {
  FREE_TIER_DAILY,
  SETUP_CODE_USED_FLAG,
  crossesAutoClose,
  type AnalyticsMetric,
} from '../../domain';
import type {AccountService} from '../identity/account_service';
import type {SessionService} from '../identity/session_service';
import type {NotificationService} from '../notification/notification_service';
import type {
  AnalyticsPort,
  BlobStore,
  PasskeyRepository,
  PendingChangeRepository,
  SystemFlagRepository,
  UsageCounter,
} from '../ports';
import type {Secrets} from '../secrets';
import {ANALYTICS_AT_KEY, ANALYTICS_KEYS} from './admin_service';
import type {AuditService} from './audit_service';
import {signKeyFlag, signKeyRotationDue} from './ops_flags';

/** Collaborators of {@link MaintenanceService}. */
export interface MaintenanceDeps {
  pending: PendingChangeRepository;
  accounts: AccountService;
  passkeys: PasskeyRepository;
  sessions: SessionService;
  notification: NotificationService;
  audit: AuditService;
  usage: UsageCounter;
  flags: SystemFlagRepository;
  blobs: BlobStore;
  analytics: AnalyticsPort | null;
  /** B2_SIGN_KEY_ID (only its hash is stored). */
  signKeyId: string | null;
  secrets: Secrets;
  clock: Clock;
  logger: Logger;
}

/** Cool-down of controlled admin changes. */
export const PENDING_CHANGE_COOLDOWN_MS = DAY_MS;

/** PlatformAdmin cron work. */
export class MaintenanceService {
  constructor(private readonly d: MaintenanceDeps) {}

  private now(): number {
    return this.d.clock.now().getTime();
  }

  /** Notifies and applies admin_pending_change rows. */
  async pendingChanges(): Promise<void> {
    const admin = await this.d.accounts.accounts.findAdmin();
    if (!admin) return;
    const contact = await this.d.accounts.contactOf(admin);
    for (const c of await this.d.pending.unnotified()) {
      const r = await this.d.notification.send(
        'admin_pending_change',
        contact.email,
        contact.locale,
        {
          kind: c.kind,
          effectiveAt: Math.max(
            c.effectiveAt,
            c.requestedAt + PENDING_CHANGE_COOLDOWN_MS,
          ),
          timeZone: contact.timeZone,
        },
        `pending_change:${c.id}`,
      );
      if (r.ok) await this.d.pending.markNotified(c.id, this.now());
    }
    const now = this.now();
    for (const c of await this.d.pending.dueForApply(now)) {
      if (c.notifiedAt === null) continue;
      if (now < c.requestedAt + PENDING_CHANGE_COOLDOWN_MS) continue;
      if (c.kind === 'email') {
        const email = await this.newEmailOf(c.payload);
        if (!email) {
          this.d.logger.error('admin.pending_change_invalid', {id: c.id});
          continue;
        }
        await this.d.accounts.accounts.replaceEmail(
          admin.userId,
          await this.d.secrets.emailHmac(email),
          await this.d.secrets.encryptEmail(email),
        );
      } else {
        await this.d.passkeys.deleteAll(admin.userId);
        await this.d.passkeys.replaceRecoveryCodes([]);
        await this.d.passkeys.clearFlag(SETUP_CODE_USED_FLAG);
      }
      await this.d.sessions.revokeUser(admin.userId);
      await this.d.pending.markApplied(c.id, now);
      this.d.logger.info('admin.pending_change_applied', {
        id: c.id,
        kind: c.kind,
      });
    }
  }

  /**
   * The new address of an `email` change: `{"emailEnc"}` (written by the
   * ops script, AES-GCM with EMAIL_ENC_KEY) or a legacy `{"email"}`.
   */
  private async newEmailOf(payload: string | null): Promise<string | null> {
    const p = parseJson<{email?: unknown; emailEnc?: unknown}>(payload, {});
    if (typeof p.emailEnc === 'string' && p.emailEnc !== '') {
      try {
        const email = await this.d.secrets.decryptEmail(p.emailEnc);
        return email.includes('@') ? email : null;
      } catch {
        return null;
      }
    }
    return typeof p.email === 'string' && p.email.includes('@')
      ? p.email
      : null;
  }

  /**
   * Hourly: account-wide usage snapshot; ≥ 80 % closes sign-up for today.
   * Without CF_ANALYTICS_TOKEN / CF_ACCOUNT_ID nothing is recorded
   * (overview: analyticsConfigured false, analyticsAt null). A failed or
   * malformed GraphQL answer logs `analytics.failed` and keeps the last
   * snapshot (never zeros).
   */
  async analyticsCheck(): Promise<boolean> {
    if (!this.d.analytics) {
      this.d.logger.warn('analytics.not_configured');
      return false;
    }
    const now = this.now();
    const day = utcDay(new Date(now));
    let snapshot: Partial<Record<AnalyticsMetric, number>>;
    try {
      snapshot = await this.d.analytics.dailyUsage(day);
    } catch (e) {
      this.d.logger.error('analytics.failed', {
        error: String(e).slice(0, 120),
      });
      return false;
    }
    for (const m of Object.keys(FREE_TIER_DAILY) as AnalyticsMetric[]) {
      await this.d.usage.set(
        day,
        ANALYTICS_KEYS[m],
        Math.round(snapshot[m] ?? 0),
      );
    }
    await this.d.usage.set(day, ANALYTICS_AT_KEY, now);
    const close = crossesAutoClose(snapshot);
    if (close) {
      await this.d.usage.set(day, 'signup_closed', 1);
      this.d.logger.warn('admin.signup_auto_closed');
    }
    return close;
  }

  /** Once a day: the latest audit row hash → B2 audit-anchors/{day}.txt. */
  async auditAnchor(): Promise<boolean> {
    const now = this.now();
    const day = utcDay(new Date(now));
    if (!(await this.d.usage.tryTake(day, 'audit_anchor', 1, 1))) return false;
    const head = await this.d.audit.head();
    try {
      await this.d.blobs.put(
        `audit-anchors/${day}.txt`,
        head
          ? `${head.rowHash} ${head.id} ${new Date(head.at).toISOString()}\n`
          : `${'0'.repeat(64)} - ${new Date(now).toISOString()}\n`,
        'text/plain; charset=utf-8',
      );
      return true;
    } catch (e) {
      await this.d.usage.adjust(day, 'audit_anchor', -1);
      throw e;
    }
  }

  /**
   * Every 12 ticks: records when the active B2 signing key was first seen
   * and logs `b2.sign_key_rotation_due` once it is older than ~30 days
   * (the overview shows `signKeyRotationDue`). Returns whether it is due.
   */
  async signKeyCheck(): Promise<boolean> {
    if (!this.d.signKeyId) return false;
    const now = this.now();
    const key = await signKeyFlag(this.d.signKeyId);
    await this.d.flags.setOnce(key, 0, now);
    const f = await this.d.flags.get(key);
    if (!f || !signKeyRotationDue(f.at, now)) return false;
    this.d.logger.warn('b2.sign_key_rotation_due', {
      ageDays: Math.floor((now - f.at) / DAY_MS),
    });
    return true;
  }

  /** Whether this cron tick is the first of its hour. */
  static isHourlyTick(now: Date): boolean {
    return now.getTime() % HOUR_MS < 2 * 60_000;
  }
}
