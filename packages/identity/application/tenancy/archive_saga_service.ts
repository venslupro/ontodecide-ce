/**
 * @fileoverview Tenancy: archiveTick (详细设计 6.11.6). Each call advances
 * one workspace by one step; progress is in purge_ledger, so any failure is
 * retried from the same step on a later call:
 *
 * - no ledger: create one for an EXPIRED trial ≥ 16 min past expired_at
 *   (object key random segment generated once; mode archive / no_archive /
 *   empty) and mark the workspace ARCHIVING;
 * - exporting: one TenantLifecycle.exportTenant page → B2 staging part; when
 *   every service is exported, ZIP (STORE) with manifest.json and README.txt
 *   → B2, HEAD check, staging removed → exported;
 * - exported: archive_index row (one per tenant, token overwritten on retry),
 *   7-day presigned GET link, archive mail (idempotency key archive:{tid});
 *   → mailed on success or once expired_at + 7 d has passed;
 * - mailed / purging: one purgeTenant(≤ 500 rows) within the daily budget;
 * - purged: verify counts, delete the account → account_deleted.
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
  type Clock,
  type Locale,
  type Logger,
} from '@ontodecide/shared-kernel';
import {zipSync, type Zippable} from 'fflate';
import {
  ARCHIVE_README,
  PURGE_STEP_ROWS,
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
  stagingPartKey,
  stagingPrefix,
  type Ledger,
  type ManifestFile,
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
      }
      return 'failed';
    }
  }

  private async start(): Promise<TickOutcome> {
    const now = this.now();
    const w = await this.d.workspaces.nextArchiveCandidate(
      now - this.d.archiveDelayMin * 60_000,
    );
    if (!w) return 'idle';
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

  private patch(
    led: Ledger,
    patch: Partial<Omit<Ledger, 'tenantId' | 'expiredAt' | 'updatedAt'>>,
  ): Promise<boolean> {
    return this.d.ledgers.update(led.tenantId, led.updatedAt, {
      ...patch,
      updatedAt: Math.max(this.now(), led.updatedAt + 1),
    });
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
      await this.d.blobs.put(
        stagingPartKey(led.tenantId, led.parts),
        encodePart(page.file, page.text),
        'text/plain; charset=utf-8',
      );
      await this.patch(led, {
        parts: led.parts + 1,
        ...advanceExport(svc, page.nextCursor),
      });
      return `export:${svc}`;
    }
    return this.zipStep(led);
  }

  private async zipStep(led: Ledger): Promise<TickOutcome> {
    const texts: {file: ReturnType<typeof decodePart>['file']; text: string}[] =
      [];
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
    const files = assembleFiles(texts);
    const now = new Date(this.now());
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
      });
    }
    const manifest = buildManifest(manifestFiles, now);
    zippable['manifest.json'] = [
      utf8(JSON.stringify(manifest, null, 2)),
      {mtime: now},
    ];
    zippable['README.txt'] = [utf8(ARCHIVE_README), {mtime: now}];
    const zip = zipSync(zippable, {level: 0});
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

  private async mailStep(led: Ledger): Promise<TickOutcome> {
    const now = this.now();
    const contact = await this.d.accounts.contactOfTenant(led.tenantId);
    const locale: Locale = led.locale === 'en-US' ? 'en-US' : 'zh-CN';
    const timeZone = led.timeZone ?? 'Asia/Shanghai';
    const key = `archive:${led.tenantId}`;
    let r: SendResult = {ok: false, status: 404};
    if (led.mode === 'archive') {
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
        {reason: led.mode === 'empty' ? 'empty' : 'admin'},
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
      await this.patch(led, {phase: 'mailed', mailed: r.ok ? 1 : 0});
      return 'mailed';
    }
    await this.patch(led, {attempts: led.attempts + 1});
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
    if (led.mode === 'archive') {
      await this.patch(led, {phase: 'account_deleted'});
    } else {
      await this.d.ledgers.delete(led.tenantId);
    }
    this.d.logger.info('tenancy.account_deleted', {tid: led.tenantId});
    return 'account_deleted';
  }
}
