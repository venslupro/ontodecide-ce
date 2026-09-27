/**
 * @fileoverview Tenancy: trial lifecycle outside the archive saga —
 * early termination, admin-ended trials, T+48 h reminders, expiry, the
 * archive "delete now" link and the final deletion of an archive.
 */

import {
  AppError,
  STREAM_CLOSE_EXPIRED,
  sha256Hex,
  type CallCtx,
  type Clock,
  type Logger,
} from '@ontodecide/shared-kernel';
import type {ArchiveDeletionInfo} from '../../contract';
import {REMINDER_AFTER_MS} from '../../domain';
import {CRON_BATCH} from '../config';
import type {AccountService} from '../identity/account_service';
import type {OtpService} from '../identity/otp_service';
import type {SessionService} from '../identity/session_service';
import type {NotificationService} from '../notification/notification_service';
import type {
  ArchiveIndexRecord,
  ArchiveIndexRepository,
  BlobStore,
  Lifecycles,
  WorkspaceRepository,
} from '../ports';

/** Collaborators of {@link TrialService}. */
export interface TrialDeps {
  workspaces: WorkspaceRepository;
  archives: ArchiveIndexRepository;
  blobs: BlobStore;
  lifecycles: Lifecycles;
  accounts: AccountService;
  sessions: SessionService;
  otp: OtpService;
  notification: NotificationService;
  clock: Clock;
  logger: Logger;
  appOrigin: string;
}

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{32,128}$/;

/** Trial lifecycle use cases. */
export class TrialService {
  constructor(private readonly d: TrialDeps) {}

  private now(): number {
    return this.d.clock.now().getTime();
  }

  /** Closes realtime connections of a workspace (best effort). */
  private async closeStreams(tenantId: string): Promise<void> {
    try {
      await this.d.lifecycles.situation.closeStreams?.(
        tenantId,
        STREAM_CLOSE_EXPIRED,
      );
    } catch (e) {
      this.d.logger.warn('tenancy.close_streams_failed', {
        tid: tenantId,
        error: AppError.from(e).code,
      });
    }
  }

  private async afterExpiry(
    tenantId: string,
    ownerUserId: string,
  ): Promise<void> {
    await this.d.sessions.revokeUser(ownerUserId);
    await this.closeStreams(tenantId);
  }

  /**
   * Ends an ACTIVE trial now (early termination, admin): trial end and
   * expired_at = now, status EXPIRED, sessions deleted, sockets closed.
   */
  async endTrial(tenantId: string): Promise<boolean> {
    const w = await this.d.workspaces.get(tenantId);
    if (!w || w.kind !== 'trial') return false;
    if (!(await this.d.workspaces.endTrial(tenantId, this.now()))) return false;
    this.d.logger.info('tenancy.trial_ended', {tid: tenantId});
    await this.afterExpiry(tenantId, w.ownerUserId);
    return true;
  }

  /** POST /me/trial/termination (owner only; the admin → FORBIDDEN). */
  async terminate(ctx: CallCtx, code: string): Promise<void> {
    if (ctx.actor.role !== 'owner' || ctx.actor.actingAs) {
      throw new AppError('FORBIDDEN');
    }
    const a = await this.d.accounts.caller(ctx);
    if (a.role !== 'owner' || a.tenantId !== ctx.tid) {
      throw new AppError('FORBIDDEN');
    }
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      throw new AppError('CODE_INVALID');
    }
    const email = await this.d.accounts.contactOf(a);
    await this.d.otp.verify(email.email, a.emailHmac, 'terminate', code);
    await this.d.otp.consume(a.emailHmac, 'terminate');
    if (!(await this.endTrial(a.tenantId))) {
      throw new AppError('CONFLICT', 'TRIAL_NOT_ACTIVE');
    }
  }

  /** Cron: T+48 h reminders (claimed before sending; deferred mail retried). */
  async sendReminders(): Promise<number> {
    const now = this.now();
    const due = await this.d.accounts.accounts.dueReminders(
      now - REMINDER_AFTER_MS,
      now,
      CRON_BATCH.reminders,
    );
    let sent = 0;
    for (const a of due) {
      if (!(await this.d.accounts.accounts.claimReminder(a.userId, now)))
        continue;
      const c = await this.d.accounts.contactOf(a);
      const r = await this.d.notification.send(
        'trial_reminder',
        c.email,
        c.locale,
        {
          expiresAt: a.trialExpiresAt,
          timeZone: c.timeZone,
          appOrigin: this.d.appOrigin,
        },
        `reminder:${a.tenantId}`,
      );
      if (r.ok) sent++;
      else await this.d.accounts.accounts.releaseReminder(a.userId);
    }
    return sent;
  }

  /** Cron: ACTIVE trials past their end → EXPIRED (kind = 'trial' only). */
  async expireDue(): Promise<number> {
    const now = this.now();
    const due = await this.d.workspaces.dueExpirations(
      now,
      CRON_BATCH.expirations,
    );
    let n = 0;
    for (const w of due) {
      if (!(await this.d.workspaces.expire(w.tenantId, now))) continue;
      n++;
      this.d.logger.info('tenancy.trial_expired', {tid: w.tenantId});
      await this.afterExpiry(w.tenantId, w.ownerUserId);
    }
    return n;
  }

  private async byToken(token: string): Promise<ArchiveIndexRecord> {
    if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) {
      throw new AppError('NOT_FOUND');
    }
    const idx = await this.d.archives.findByTokenHash(await sha256Hex(token));
    if (!idx || idx.expiresAt <= this.now()) throw new AppError('NOT_FOUND');
    return idx;
  }

  /** GET /archive-deletions/{token}. */
  async archiveDeletionInfo(token: string): Promise<ArchiveDeletionInfo> {
    const idx = await this.byToken(token);
    return {
      expiresAt: new Date(idx.expiresAt).toISOString(),
      sizeBytes: idx.sizeBytes,
    };
  }

  /** POST /archive-deletions/{token}. */
  async deleteArchiveByToken(token: string): Promise<void> {
    await this.finalDelete(await this.byToken(token));
  }

  /**
   * Deletes every B2 version of the ZIP, then archive_index and
   * purge_ledger, and writes the tombstone.
   */
  async finalDelete(idx: ArchiveIndexRecord): Promise<void> {
    await this.d.blobs.deleteAllVersions(idx.objectKey);
    await this.d.archives.finalDelete(idx.tenantId, this.now());
    this.d.logger.info('tenancy.archive_deleted', {tid: idx.tenantId});
  }

  /** Cron: final deletion of expired archives. */
  async finalDeleteDue(limit = 1): Promise<number> {
    const due = await this.d.archives.due(this.now(), limit);
    for (const idx of due) await this.finalDelete(idx);
    return due.length;
  }
}
