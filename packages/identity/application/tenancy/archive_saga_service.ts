/**
 * @fileoverview Tenancy: archiveTick (详细设计 6.11.6). Each call advances
 * one workspace by one step; progress is in purge_ledger, so any failure is
 * retried from the same step on a later call:
 *
 * - no ledger: create one for an EXPIRED trial ≥ 16 min past expired_at
 *   (object key random segment generated once; mode archive / no_archive /
 *   empty) and mark the workspace ARCHIVING. An ARCHIVING workspace whose
 *   ledger is gone is resumed at the purge (no export, no mail);
 * - exporting: one TenantLifecycle.exportTenant page → B2 staging part
 *   (≤ 20 parts: a service's last allowed page is marked truncated); when
 *   every service is exported, ZIP (STORE) with manifest.json and README.txt
 *   → B2 (≤ 2 MB: the largest files are truncated, noted in the manifest),
 *   HEAD check, staging removed → exported;
 * - exported: archive_index row (one per tenant, token overwritten on retry),
 *   7-day presigned GET link, archive mail (idempotency key archive:{tid});
 *   → mailed on success or once expired_at + 7 d has passed. A ZIP deleted
 *   meanwhile (admin) turns the saga into no_archive (deletion notice);
 * - mailed / purging: one purgeTenant(≤ 500 rows) within the daily budget;
 * - purged: verify counts, delete the account → account_deleted (the ledger
 *   stays until the ZIP is deleted; it goes at once when the ZIP already is).
 *
 * "Delete now" / admin archive deletion / the 7-day final delete remove the
 * ZIP and archive_index at any phase but never the ledger of an unfinished
 * saga, so the data and the account are always deleted.
 *
 * A step failing for 24 h in a row logs `archive.step_stuck` (error, tid
 * only) and counts `archive_stuck` in usage_counter; the overview shows the
 * number of stuck sagas.
 */

import {
  AppError,
  DAY_MS,
  PURGE_ORDER,
  EXPORT_ORDER,
  randomBytes,
  randomToken,
  sha256Hex,
  toHex,
  utcDay,
  utf8,
  type ArchiveFile,
  type Clock,
  type Locale,
  type Logger,
} from '@ontodecide/shared-kernel';
import {zipSync, type Zippable} from 'fflate';
import {
  ARCHIVE_README,
  MAX_ARCHIVE_BYTES,
  PURGE_STEP_ROWS,
  ZIP_OVERHEAD_BYTES,
  advanceExport,
  advancePurge,
  archiveObjectKey,
  assembleFiles,
  buildManifest,
  chooseMode,
  countRecords,
  currentExportService,
  currentPurgeService,
  decodePart,
  encodePart,
  fitToBudget,
  isLastAllowedPart,
  stagingPartKey,
  stagingPrefix,
  type Ledger,
  type ManifestFile,
  type StagedPart,
} from '../../domain';
import type {AccountService} from '../identity/account_service';
import type {NotificationService} from '../notification/notification_service';
import type {
  ArchiveIndexRepository,
  BlobStore,
  LedgerRepository,
  Lifecycles,
  LinkSigner,
  SendResult,
  SystemFlagRepository,
  UsageCounter,
  WorkspaceRepository,
} from '../ports';

/** Collaborators and settings of the saga. */
export interface SagaDeps {
  ledgers: LedgerRepository;
  workspaces: WorkspaceRepository;
  archives: ArchiveIndexRepository;
  blobs: BlobStore;
  signer: LinkSigner;
  lifecycles: Lifecycles;
  usage: UsageCounter;
  flags: SystemFlagRepository;
  accounts: AccountService;
  notification: NotificationService;
  clock: Clock;
  logger: Logger;
  appOrigin: string;
  archiveDelayMin: number;
  archiveDays: number;
  archiveLinkTtlS: number;
  purgeRowsDaily: number;
}

/** What one tick did (for logs and tests). */
export type TickOutcome =
  | 'idle'
  | 'created'
  | 'resumed'
  | `export:${string}`
  | 'zipped'
  | 'export_restarted'
  | 'mailed'
  | 'mail_failed'
  | `purge:${string}`
  | 'purge_budget'
  | 'purge_incomplete'
  | 'account_deleted'
  | 'failed';

const ZIP_CONTENT_TYPE = 'application/zip';

/** system_flag key prefix: first failure time of a saga's current step. */
export const ARCHIVE_FAIL_PREFIX = 'archive_fail:';

/** A step failing this long in a row raises `archive.step_stuck`. */
export const ARCHIVE_STUCK_AFTER_MS = DAY_MS;

/** usage_counter key counting stuck-archive alerts per day. */
export const ARCHIVE_STUCK_KEY = 'archive_stuck';

/** The staged archive saga. */
export class ArchiveSagaService {
  constructor(private readonly d: SagaDeps) {}

  private now(): number {
    return this.d.clock.now().getTime();
  }

  /** Advances one workspace by one step. */
  async tick(): Promise<TickOutcome> {
    const led = await this.d.ledgers.next();
    if (!led) return this.start();
    try {
      return await this.step(led);
    } catch (e) {
      const err = AppError.from(e);
      this.d.logger.warn('tenancy.archive_step_failed', {
        tid: led.tenantId,
        phase: led.phase,
        code: err.code,
      });
      const fresh = await this.d.ledgers.get(led.tenantId);
      if (fresh) {
        await this.d.ledgers.update(fresh.tenantId, fresh.updatedAt, {
          attempts: fresh.attempts + 1,
          updatedAt: Math.max(this.now(), fresh.updatedAt + 1),
        });
        await this.noteFailure(fresh);
      }
      return 'failed';
    }
  }

  /**
   * Records a failed step: the first failure time is kept in system_flag;
   * after 24 h of consecutive failures one alert is raised per episode.
   */
  private async noteFailure(led: Ledger): Promise<void> {
    const key = `${ARCHIVE_FAIL_PREFIX}${led.tenantId}`;
    const now = this.now();
    try {
      await this.d.flags.setOnce(key, 0, now);
      const f = await this.d.flags.get(key);
      if (!f || f.value !== 0 || now - f.at < ARCHIVE_STUCK_AFTER_MS) return;
      this.d.logger.error('archive.step_stuck', {
        tid: led.tenantId,
        phase: led.phase,
        attempts: led.attempts + 1,
        sinceMs: now - f.at,
      });
      await this.d.usage.tryTake(
        utcDay(new Date(now)),
        ARCHIVE_STUCK_KEY,
        1,
        Number.MAX_SAFE_INTEGER,
      );
      await this.d.flags.setValue(key, 1);
    } catch (e) {
      this.d.logger.warn('tenancy.archive_failure_note_failed', {
        tid: led.tenantId,
        code: AppError.from(e).code,
      });
    }
  }

  /** Clears the failure record after a successful step. */
  private async clearFailure(tenantId: string): Promise<void> {
    await this.d.flags.clear(`${ARCHIVE_FAIL_PREFIX}${tenantId}`);
  }

  private async start(): Promise<TickOutcome> {
    const now = this.now();
    const w = await this.d.workspaces.nextArchiveCandidate(
      now - this.d.archiveDelayMin * 60_000,
    );
    if (!w) return 'idle';
    if (w.status === 'ARCHIVING') return this.resume(w.tenantId, w.expiredAt);
    let rows = 0;
    if (w.deleteMode !== 'no_archive') {
      const counts = await Promise.all(
        EXPORT_ORDER.map(s => this.d.lifecycles[s].countTenant(w.tenantId)),
      );
      rows = counts.reduce((a, b) => a + b, 0);
    }
    const mode = chooseMode(w.deleteMode, rows);
    const contact = await this.d.accounts.contactOfTenant(w.tenantId);
    const created = await this.d.ledgers.create({
      tenantId: w.tenantId,
      phase: 'exporting',
      mode,
      objectKey:
        mode === 'archive'
          ? archiveObjectKey(w.tenantId, toHex(randomBytes(16)))
          : null,
      exportSvc: null,
      exportCursor: null,
      parts: 0,
      sizeBytes: null,
      sha256: null,
      purgeSvc: null,
      locale: contact?.locale ?? 'zh-CN',
      timeZone: contact?.timeZone ?? 'Asia/Shanghai',
      expiredAt: w.expiredAt ?? now,
      mailed: null,
      attempts: 0,
      updatedAt: now,
    });
    if (created) await this.d.workspaces.markArchiving(w.tenantId);
    this.d.logger.info('tenancy.archive_started', {tid: w.tenantId, mode});
    return 'created';
  }

  /**
   * An ARCHIVING workspace without a ledger (lost, e.g. by an early archive
   * deletion in an older version): the archive mail went out already, so
   * the saga resumes at the purge without exporting or mailing again, and
   * without an archive (the ledger goes with the account).
   */
  private async resume(
    tenantId: string,
    expiredAt: number | null,
  ): Promise<TickOutcome> {
    const now = this.now();
    await this.d.ledgers.create({
      tenantId,
      phase: 'mailed',
      mode: 'no_archive',
      objectKey: null,
      exportSvc: null,
      exportCursor: null,
      parts: 0,
      sizeBytes: null,
      sha256: null,
      purgeSvc: null,
      locale: null,
      timeZone: null,
      expiredAt: expiredAt ?? now,
      mailed: null,
      attempts: 0,
      updatedAt: now,
    });
    this.d.logger.warn('tenancy.archive_resumed', {tid: tenantId});
    return 'resumed';
  }

  /**
   * Persists a step result. A successful step (no explicit `attempts`)
   * resets the failure count and the stuck-step record.
   */
  private async patch(
    led: Ledger,
    patch: Partial<Omit<Ledger, 'tenantId' | 'expiredAt' | 'updatedAt'>>,
  ): Promise<boolean> {
    const reset = patch.attempts === undefined && led.attempts > 0;
    const ok = await this.d.ledgers.update(led.tenantId, led.updatedAt, {
      ...patch,
      ...(reset ? {attempts: 0} : {}),
      updatedAt: Math.max(this.now(), led.updatedAt + 1),
    });
    if (ok && reset) await this.clearFailure(led.tenantId);
    return ok;
  }

  private async step(led: Ledger): Promise<TickOutcome> {
    switch (led.phase) {
      case 'exporting':
        return this.exportStep(led);
      case 'exported':
        return this.mailStep(led);
      case 'mailed':
      case 'purging':
        return this.purgeStep(led);
      case 'purged':
        return this.deleteAccountStep(led);
      default:
        return 'idle';
    }
  }

  private async exportStep(led: Ledger): Promise<TickOutcome> {
    if (led.mode !== 'archive') {
      await this.patch(led, {phase: 'exported'});
      return 'zipped';
    }
    const svc = currentExportService(led);
    if (svc) {
      const page = await this.d.lifecycles[svc].exportTenant(
        led.tenantId,
        led.exportCursor,
      );
      // Part budget: the last allowed page of a service ends its export.
      const cut = page.nextCursor !== null && isLastAllowedPart(svc, led.parts);
      if (cut) {
        this.d.logger.warn('tenancy.archive_parts_capped', {
          tid: led.tenantId,
          svc,
        });
      }
      await this.d.blobs.put(
        stagingPartKey(led.tenantId, led.parts),
        encodePart(page.file, page.text, cut),
        'text/plain; charset=utf-8',
      );
      await this.patch(led, {
        parts: led.parts + 1,
        ...advanceExport(svc, cut ? null : page.nextCursor),
      });
      return `export:${svc}`;
    }
    return this.zipStep(led);
  }

  private async zipStep(led: Ledger): Promise<TickOutcome> {
    const texts: StagedPart[] = [];
    for (let i = 0; i < led.parts; i++) {
      const b = await this.d.blobs.get(stagingPartKey(led.tenantId, i));
      if (!b) {
        // A staging part is gone (e.g. lifecycle rule): export again.
        await this.d.blobs.deletePrefix(stagingPrefix(led.tenantId));
        await this.patch(led, {exportSvc: null, exportCursor: null, parts: 0});
        return 'export_restarted';
      }
      texts.push(decodePart(new TextDecoder().decode(b)));
    }
    const cutParts = new Set(texts.filter(t => t.truncated).map(t => t.file));
    const assembled = assembleFiles(texts);
    const now = new Date(this.now());
    // ≤ 2 MB: truncate the largest files (whole JSON Lines) until it fits.
    let budget = MAX_ARCHIVE_BYTES - ZIP_OVERHEAD_BYTES;
    let zip: Uint8Array = new Uint8Array();
    for (let round = 0; round < 3; round++) {
      const fit = fitToBudget(assembled, budget);
      zip = await this.buildZip(
        fit.files,
        new Set([...cutParts, ...fit.truncated]),
        now,
      );
      if (zip.byteLength <= MAX_ARCHIVE_BYTES) break;
      budget -= zip.byteLength - MAX_ARCHIVE_BYTES + 4096;
    }
    if (zip.byteLength > MAX_ARCHIVE_BYTES) {
      throw new AppError('INTERNAL', 'ARCHIVE_TOO_LARGE');
    }
    const key = led.objectKey!;
    await this.d.blobs.put(key, zip, ZIP_CONTENT_TYPE);
    const head = await this.d.blobs.head(key);
    if (!head || head.size !== zip.byteLength) {
      throw new AppError('UNAVAILABLE', 'ARCHIVE_HEAD_MISMATCH');
    }
    await this.d.blobs.deletePrefix(stagingPrefix(led.tenantId));
    await this.patch(led, {
      phase: 'exported',
      sizeBytes: zip.byteLength,
      sha256: await sha256Hex(zip),
    });
    return 'zipped';
  }

  private async buildZip(
    files: ReadonlyMap<ArchiveFile, string>,
    truncated: ReadonlySet<ArchiveFile>,
    now: Date,
  ): Promise<Uint8Array> {
    const zippable: Zippable = {};
    const manifestFiles: ManifestFile[] = [];
    for (const [name, text] of files) {
      const bytes = utf8(text);
      zippable[name] = [bytes, {mtime: now}];
      manifestFiles.push({
        name,
        records: countRecords(name, text),
        bytes: bytes.byteLength,
        sha256: await sha256Hex(bytes),
        ...(truncated.has(name) ? {truncated: true as const} : {}),
      });
    }
    const manifest = buildManifest(manifestFiles, now);
    zippable['manifest.json'] = [
      utf8(JSON.stringify(manifest, null, 2)),
      {mtime: now},
    ];
    zippable['README.txt'] = [utf8(ARCHIVE_README), {mtime: now}];
    return zipSync(zippable, {level: 0});
  }

  private async mailStep(led: Ledger): Promise<TickOutcome> {
    const now = this.now();
    const contact = await this.d.accounts.contactOfTenant(led.tenantId);
    const locale: Locale = led.locale === 'en-US' ? 'en-US' : 'zh-CN';
    const timeZone = led.timeZone ?? 'Asia/Shanghai';
    const key = `archive:${led.tenantId}`;
    let r: SendResult = {ok: false, status: 404};
    let mode = led.mode;
    if (mode === 'archive' && !(await this.d.blobs.head(led.objectKey!))) {
      // The ZIP was deleted before the mail (admin): no link, no index;
      // the owner gets the deletion notice instead.
      this.d.logger.warn('tenancy.archive_zip_gone', {tid: led.tenantId});
      await this.d.archives.finalDelete(led.tenantId, now);
      mode = 'no_archive';
    }
    if (mode === 'archive') {
      const token = randomToken(32);
      const expiresAt = now + this.d.archiveLinkTtlS * 1000;
      await this.d.archives.upsert({
        tenantId: led.tenantId,
        objectKey: led.objectKey!,
        sizeBytes: led.sizeBytes ?? 0,
        sha256: led.sha256 ?? '',
        deletionTokenHash: await sha256Hex(token),
        createdAt: now,
        expiresAt,
      });
      const url = await this.d.signer.presignGet(
        led.objectKey!,
        this.d.archiveLinkTtlS,
        `attachment; filename="ontodecide-archive-${utcDay(new Date(now))}.zip"`,
      );
      if (contact) {
        r = await this.d.notification.send(
          'archive_ready',
          contact.email,
          locale,
          {
            url,
            deleteUrl: `${this.d.appOrigin}/archive-deletions/${token}`,
            sizeBytes: led.sizeBytes ?? 0,
            sha256: led.sha256 ?? '',
            expiresAt,
            timeZone,
          },
          key,
        );
      }
    } else if (contact) {
      r = await this.d.notification.send(
        'account_deleted',
        contact.email,
        locale,
        {reason: mode === 'empty' ? 'empty' : 'admin'},
        key,
      );
    }
    const givenUp = now > led.expiredAt + this.d.archiveDays * DAY_MS;
    if (r.ok || givenUp) {
      if (!r.ok) {
        this.d.logger.error('tenancy.archive_mail_given_up', {
          tid: led.tenantId,
        });
      }
      await this.patch(led, {phase: 'mailed', mailed: r.ok ? 1 : 0, mode});
      return 'mailed';
    }
    await this.patch(led, {attempts: led.attempts + 1, mode});
    await this.noteFailure(led);
    return 'mail_failed';
  }

  private async purgeStep(led: Ledger): Promise<TickOutcome> {
    const day = utcDay(new Date(this.now()));
    if (
      !(await this.d.usage.tryTake(
        day,
        'purge_rows',
        PURGE_STEP_ROWS,
        this.d.purgeRowsDaily,
      ))
    ) {
      return 'purge_budget';
    }
    const svc = currentPurgeService(led);
    let deleted = 0;
    try {
      const r = await this.d.lifecycles[svc].purgeTenant(
        led.tenantId,
        PURGE_STEP_ROWS,
      );
      deleted = r.deleted;
      await this.patch(led, advancePurge(svc, r.done));
    } finally {
      const unused = PURGE_STEP_ROWS - Math.min(PURGE_STEP_ROWS, deleted);
      if (unused > 0) await this.d.usage.adjust(day, 'purge_rows', -unused);
    }
    return `purge:${svc}`;
  }

  private async deleteAccountStep(led: Ledger): Promise<TickOutcome> {
    for (const svc of PURGE_ORDER) {
      if ((await this.d.lifecycles[svc].countTenant(led.tenantId)) > 0) {
        await this.patch(led, {phase: 'purging', purgeSvc: svc});
        return 'purge_incomplete';
      }
    }
    await this.d.workspaces.deleteAccount(led.tenantId, this.now());
    // Keep the ledger only while a ZIP remains to be deleted.
    const zipKept =
      led.mode === 'archive' && (await this.d.archives.get(led.tenantId));
    if (zipKept) {
      await this.patch(led, {phase: 'account_deleted'});
    } else {
      await this.d.ledgers.delete(led.tenantId);
      if (led.attempts > 0) await this.clearFailure(led.tenantId);
    }
    this.d.logger.info('tenancy.account_deleted', {tid: led.tenantId});
    return 'account_deleted';
  }
}
