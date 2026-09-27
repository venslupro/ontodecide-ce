/**
 * @fileoverview PlatformAdmin maintenance run by the cron: controlled admin
 * changes written by the ops script (24 h cool-down, original address
 * notified), the hourly account-wide analytics check (≥ 80 % closes
 * sign-up) and the daily audit anchor in B2.
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
  UsageCounter,
} from '../ports';
import type {Secrets} from '../secrets';
import {ANALYTICS_AT_KEY, ANALYTICS_KEYS} from './admin_service';
import type {AuditService} from './audit_service';

/** Collaborators of {@link MaintenanceService}. */
export interface MaintenanceDeps {
  pending: PendingChangeRepository;
  accounts: AccountService;
  passkeys: PasskeyRepository;
  sessions: SessionService;
  notification: NotificationService;
  audit: AuditService;
  usage: UsageCounter;
  blobs: BlobStore;
  analytics: AnalyticsPort | null;
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
        const email = parseJson<{email?: string}>(c.payload, {}).email;
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

  /** Hourly: account-wide usage snapshot; ≥ 80 % closes sign-up for today. */
  async analyticsCheck(): Promise<boolean> {
    if (!this.d.analytics) return false;
    const now = this.now();
    const day = utcDay(new Date(now));
    let snapshot: Partial<Record<AnalyticsMetric, number>>;
    try {
      snapshot = await this.d.analytics.dailyUsage(day);
    } catch (e) {
      this.d.logger.warn('admin.analytics_failed', {
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

  /** Whether this cron tick is the first of its hour. */
  static isHourlyTick(now: Date): boolean {
    return now.getTime() % HOUR_MS < 2 * 60_000;
  }
}
