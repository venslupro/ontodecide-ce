/**
 * @fileoverview Trial end → archive saga → deletion (详细设计 表 14 归档
 * Saga 可重入 / 端到端：归档与删除验收) with injected failures.
 */

import {beforeEach, describe, expect, it} from 'vitest';
import {unzipSync} from 'fflate';
import {
  AppError,
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  fromUtf8,
  sha256Hex,
} from '@ontodecide/shared-kernel';
import {createTestD1} from '@ontodecide/testing';
import type {IssuedSession} from '../contract';
import type {Ledger} from '../domain';
import {ARCHIVE_FAIL_PREFIX, ARCHIVE_STUCK_AFTER_MS} from '../application';
import {runCron} from './cron';
import {allMail, createHarness, signup, type Harness} from './test_fixtures';

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return AppError.from(e).code;
  }
}

function ledger(h: Harness, tid: string): Promise<Ledger | null> {
  return h.services.saga['d'].ledgers.get(tid);
}

async function n(h: Harness, sql: string, ...args: unknown[]): Promise<number> {
  const r = await h.db
    .prepare(sql)
    .bind(...args)
    .first<{n: number}>();
  return r?.n ?? 0;
}

/** Blob keys except the daily audit anchors. */
function dataKeys(h: Harness): string[] {
  return h.blobs.keys().filter(k => !k.startsWith('audit-anchors/'));
}

function tokenOf(h: Harness): string {
  const m = allMail(h)
    .filter(x => x.template === 'archive_ready')
    .pop()!;
  return /archive-deletions\/([A-Za-z0-9_-]+)/.exec(m.text)![1];
}

describe('archive saga', () => {
  let h: Harness;
  let s: IssuedSession;
  let tid: string;

  beforeEach(async () => {
    h = await createHarness(createTestD1('identity-access'));
    s = await signup(h, 'carol@example.com');
    tid = s.me.workspace.tenantId;
    const l = h.lifecycles;
    l.ontology.rows.set(tid, 1);
    l.integration.rows.set(tid, 1);
    l.objects.rows.set(tid, 5);
    l.situation.rows.set(tid, 2);
    l.decision.rows.set(tid, 700); // two purge steps (≤ 500 rows each)
  });

  async function expire(): Promise<void> {
    h.clock.advance(72 * HOUR_MS);
    const r = await runCron(h.services, h.clock.now());
    expect(r.expired).toBe(1);
  }

  it('reminds at T+48 h once, then expires and waits 16 minutes', async () => {
    h.clock.advance(48 * HOUR_MS);
    expect((await runCron(h.services, h.clock.now())).reminders).toBe(1);
    expect((await runCron(h.services, h.clock.now())).reminders).toBe(0);
    const reminder = allMail(h).filter(m => m.template === 'trial_reminder');
    expect(reminder).toHaveLength(1);
    h.clock.advance(24 * HOUR_MS);
    const r = await runCron(h.services, h.clock.now());
    expect(r.expired).toBe(1);
    expect(await h.rpc.workspaceStatus(tid)).toEqual({
      kind: 'trial',
      status: 'EXPIRED',
    });
    expect(await n(h, 'SELECT COUNT(*) AS n FROM session')).toBe(0);
    expect(h.lifecycles.situation.closed).toEqual([{tid, code: 4401}]);
    h.clock.advance(15 * MINUTE_MS);
    expect(await h.services.saga.tick()).toBe('idle');
    h.clock.advance(MINUTE_MS);
    expect(await h.services.saga.tick()).toBe('created');
    expect(await h.rpc.workspaceStatus(tid)).toEqual({
      kind: 'trial',
      status: 'ARCHIVING',
    });
  });

  it('archives, mails, purges and deletes the account one step per call', async () => {
    await expire();
    h.clock.advance(16 * MINUTE_MS);
    const steps: string[] = [];
    for (let i = 0; i < 40; i++) {
      const out = await h.services.saga.tick();
      if (out === 'idle') break;
      steps.push(out);
    }
    expect(steps).toEqual([
      'created',
      'export:ontology',
      'export:integration',
      'export:objects',
      'export:objects',
      'export:objects',
      'export:situation',
      'export:decision',
      'zipped',
      'mailed',
      'purge:situation',
      'purge:decision',
      'purge:decision',
      'purge:objects',
      'purge:integration',
      'purge:ontology',
      'account_deleted',
    ]);
    const led = await ledger(h, tid);
    expect(led!.phase).toBe('account_deleted');
    // The ZIP: manifest + README + files; staging removed.
    expect(dataKeys(h)).toEqual([led!.objectKey]);
    expect(led!.objectKey).toMatch(
      new RegExp(`^archives/${tid}/[0-9a-f]{32}\\.zip$`),
    );
    const zip = (await h.blobs.get(led!.objectKey!))!;
    expect(await sha256Hex(zip)).toBe(led!.sha256);
    const files = unzipSync(zip);
    const manifest = JSON.parse(fromUtf8(files['manifest.json']));
    expect(manifest.formatVersion).toBe(1);
    const objects = manifest.files.find(
      (f: {name: string}) => f.name === 'objects.jsonl',
    );
    expect(objects.records).toBe(5);
    expect(objects.sha256).toBe(await sha256Hex(files['objects.jsonl']));
    expect(Object.keys(files).sort()).toEqual([
      'README.txt',
      'decisions.json',
      'imports.json',
      'manifest.json',
      'objects.jsonl',
      'ontology.json',
      'situation.json',
    ]);
    expect(fromUtf8(files['manifest.json'])).not.toContain('carol');
    // The archive mail (idempotency key archive:{tid}) with both links.
    const mail = allMail(h).filter(m => m.template === 'archive_ready');
    expect(mail).toHaveLength(1);
    expect(mail[0].key).toBe(`archive:${tid}`);
    expect(mail[0].text).toContain(`https://blob.test/${led!.objectKey}`);
    expect(mail[0].text).toContain('ttl=604800');
    expect(mail[0].text).toContain('https://app.test/archive-deletions/');
    // Account and e-mail gone; tombstones everywhere.
    expect(
      await n(
        h,
        'SELECT COUNT(*) AS n FROM user_account WHERE tenant_id = ?1',
        tid,
      ),
    ).toBe(0);
    expect(
      await n(
        h,
        'SELECT COUNT(*) AS n FROM workspace WHERE tenant_id = ?1',
        tid,
      ),
    ).toBe(0);
    expect(
      await n(
        h,
        'SELECT COUNT(*) AS n FROM tenant_tombstone WHERE tenant_id = ?1',
        tid,
      ),
    ).toBe(1);
    for (const lc of Object.values(h.lifecycles))
      expect(lc.tombstones.has(tid)).toBe(true);
    expect(await n(h, 'SELECT COUNT(*) AS n FROM archive_index')).toBe(1);
    // Admin list derives ARCHIVE_ONLY.
    expect(await h.services.saga.tick()).toBe('idle');

    // "Delete now" link.
    const token = tokenOf(h);
    const info = await h.rpc.getArchiveDeletion(token);
    expect(info.sizeBytes).toBe(zip.byteLength);
    await h.rpc.deleteArchiveByToken(token);
    expect(dataKeys(h)).toEqual([]);
    expect(await n(h, 'SELECT COUNT(*) AS n FROM archive_index')).toBe(0);
    expect(await n(h, 'SELECT COUNT(*) AS n FROM purge_ledger')).toBe(0);
    expect(await code(h.rpc.getArchiveDeletion(token))).toBe('NOT_FOUND');
    expect(await code(h.rpc.deleteArchiveByToken(token))).toBe('NOT_FOUND');
    expect(await code(h.rpc.getArchiveDeletion('short'))).toBe('NOT_FOUND');
  });

  it('is re-entrant: failures at each phase keep the key, the row and the mail single', async () => {
    await expire();
    h.clock.advance(16 * MINUTE_MS);
    expect(await h.services.saga.tick()).toBe('created');
    const key = (await ledger(h, tid))!.objectKey;

    h.lifecycles.ontology.failNext();
    expect(await h.services.saga.tick()).toBe('failed');
    expect((await ledger(h, tid))!.attempts).toBe(1);
    // Export resumes where it stopped.
    while ((await ledger(h, tid))!.exportSvc !== 'DONE') {
      expect(await h.services.saga.tick()).toMatch(/^export:/);
    }
    h.blobs.failNext('put');
    expect(await h.services.saga.tick()).toBe('failed');
    h.blobs.corruptNextHead = true;
    expect(await h.services.saga.tick()).toBe('failed');
    expect(await h.services.saga.tick()).toBe('zipped');
    const led = (await ledger(h, tid))!;
    expect(led.objectKey).toBe(key);
    // Re-uploads only add versions at the same path.
    expect(dataKeys(h)).toEqual([key]);

    h.resend.script.push(500);
    expect(await h.services.saga.tick()).toBe('mail_failed');
    const firstHash = await h.db
      .prepare('SELECT deletion_token_hash AS t FROM archive_index')
      .first<{t: string}>();
    const exportsBefore = h.lifecycles.objects.exportCalls;
    expect(await h.services.saga.tick()).toBe('mailed');
    const rows = await h.db
      .prepare('SELECT deletion_token_hash AS t FROM archive_index')
      .all<{t: string}>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0].t).not.toBe(firstHash!.t);
    expect(rows.results[0].t).toBe(await sha256Hex(tokenOf(h)));

    h.lifecycles.situation.failNext();
    expect(await h.services.saga.tick()).toBe('failed');
    for (
      let i = 0;
      i < 20 && (await ledger(h, tid))!.phase !== 'account_deleted';
      i++
    ) {
      await h.services.saga.tick();
    }
    expect((await ledger(h, tid))!.phase).toBe('account_deleted');
    // No re-export after the mail and exactly one archive mail.
    expect(h.lifecycles.objects.exportCalls).toBe(exportsBefore);
    expect(allMail(h).filter(m => m.template === 'archive_ready')).toHaveLength(
      1,
    );
    expect((await ledger(h, tid))!.objectKey).toBe(key);
  });

  it('keeps the account while mail fails, then deletes after expired_at + 7 d', async () => {
    await expire();
    h.clock.advance(16 * MINUTE_MS);
    for (let i = 0; i < 9; i++) await h.services.saga.tick();
    expect((await ledger(h, tid))!.phase).toBe('exported');
    h.resend.script.push(500, 500);
    expect(await h.services.saga.tick()).toBe('mail_failed');
    expect(
      await n(
        h,
        'SELECT COUNT(*) AS n FROM user_account WHERE tenant_id = ?1',
        tid,
      ),
    ).toBe(1);
    h.clock.advance(7 * DAY_MS);
    expect(await h.services.saga.tick()).toBe('mailed');
    expect((await ledger(h, tid))!.mailed).toBe(0);
  });

  it('defers purging when the daily purge budget is used', async () => {
    await expire();
    h.clock.advance(16 * MINUTE_MS);
    for (let i = 0; i < 10; i++) await h.services.saga.tick();
    expect((await ledger(h, tid))!.phase).toBe('mailed');
    const day = h.clock.now().toISOString().slice(0, 10);
    await h.db
      .prepare(
        "INSERT INTO usage_counter (day, key, value) VALUES (?1, 'purge_rows', 29600)",
      )
      .bind(day)
      .run();
    expect(await h.services.saga.tick()).toBe('purge_budget');
    h.clock.advance(DAY_MS);
    expect(await h.services.saga.tick()).toBe('purge:situation');
    // Unused reservation refunded: 2 rows were deleted.
    const used = await h.db
      .prepare(
        "SELECT value AS n FROM usage_counter WHERE key = 'purge_rows' AND day = ?1",
      )
      .bind(h.clock.now().toISOString().slice(0, 10))
      .first<{n: number}>();
    expect(used!.n).toBe(2);
  });

  it('final deletion after 7 days via the cron', async () => {
    await expire();
    h.clock.advance(16 * MINUTE_MS);
    for (let i = 0; i < 17; i++) await h.services.saga.tick();
    expect(await n(h, 'SELECT COUNT(*) AS n FROM archive_index')).toBe(1);
    h.clock.advance(7 * DAY_MS);
    const r = await runCron(h.services, h.clock.now());
    expect(r.finalDeleted).toBe(1);
    expect(dataKeys(h)).toEqual([]);
    expect(await n(h, 'SELECT COUNT(*) AS n FROM purge_ledger')).toBe(0);
    // Tombstones are swept 48 h later.
    h.clock.advance(49 * HOUR_MS);
    await runCron(h.services, h.clock.now());
    expect(await n(h, 'SELECT COUNT(*) AS n FROM tenant_tombstone')).toBe(0);
  });
});

describe('saga without an archive', () => {
  it('empty workspace → account_deleted mail and no ZIP', async () => {
    const h = await createHarness(createTestD1('identity-access'));
    const s = await signup(h, 'empty@example.com', '192.0.2.1');
    h.clock.advance(72 * HOUR_MS + 16 * MINUTE_MS);
    await h.services.trials.expireDue();
    h.clock.advance(16 * MINUTE_MS);
    const out: string[] = [];
    for (let i = 0; i < 12; i++) out.push(await h.services.saga.tick());
    expect(out.slice(0, 3)).toEqual(['created', 'zipped', 'mailed']);
    expect(out).toContain('account_deleted');
    expect(dataKeys(h)).toEqual([]);
    const m = allMail(h).filter(x => x.template === 'account_deleted');
    expect(m).toHaveLength(1);
    expect(m[0].to).toBe('empty@example.com');
    expect(await n(h, 'SELECT COUNT(*) AS n FROM purge_ledger')).toBe(0);
    expect(
      await n(
        h,
        'SELECT COUNT(*) AS n FROM user_account WHERE tenant_id = ?1',
        s.me.workspace.tenantId,
      ),
    ).toBe(0);
  });

  it('admin delete with archive=false → no ZIP, deletion notice', async () => {
    const h = await createHarness(createTestD1('identity-access'));
    const s = await signup(h, 'gone@example.com');
    h.lifecycles.objects.rows.set(s.me.workspace.tenantId, 3);
    await h.db
      .prepare(
        "UPDATE workspace SET delete_mode = 'no_archive' WHERE tenant_id = ?1",
      )
      .bind(s.me.workspace.tenantId)
      .run();
    await h.services.trials.endTrial(s.me.workspace.tenantId);
    h.clock.advance(16 * MINUTE_MS);
    for (let i = 0; i < 12; i++) await h.services.saga.tick();
    expect(dataKeys(h)).toEqual([]);
    expect(h.lifecycles.objects.exportCalls).toBe(0);
    expect(h.lifecycles.objects.rows.get(s.me.workspace.tenantId)).toBe(0);
    expect(
      allMail(h).filter(x => x.template === 'account_deleted'),
    ).toHaveLength(1);
    expect(allMail(h).filter(x => x.template === 'archive_ready')).toHaveLength(
      0,
    );
  });
});

describe('archive deleted before the saga finished (A1)', () => {
  let h: Harness;
  let tid: string;

  beforeEach(async () => {
    h = await createHarness(createTestD1('identity-access'));
    const s = await signup(h, 'early@example.com');
    tid = s.me.workspace.tenantId;
    h.lifecycles.objects.rows.set(tid, 5);
    h.lifecycles.decision.rows.set(tid, 1200); // three purge steps
    h.clock.advance(72 * HOUR_MS);
    await runCron(h.services, h.clock.now());
    h.clock.advance(16 * MINUTE_MS);
  });

  async function tickUntil(phase: string): Promise<void> {
    for (let i = 0; i < 30; i++) {
      if ((await ledger(h, tid))?.phase === phase) return;
      await h.services.saga.tick();
    }
    throw new Error(`phase ${phase} not reached`);
  }

  async function finish(): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < 30; i++) {
      h.clock.advance(2 * MINUTE_MS);
      const r = await runCron(h.services, h.clock.now());
      out.push(r.archive);
    }
    return out;
  }

  async function expectFullyDeleted(): Promise<void> {
    for (const lc of Object.values(h.lifecycles))
      expect(lc.rows.get(tid) ?? 0).toBe(0);
    for (const t of [
      'user_account',
      'workspace',
      'purge_ledger',
      'archive_index',
    ]) {
      expect(
        await n(h, `SELECT COUNT(*) AS n FROM ${t} WHERE tenant_id = ?1`, tid),
        t,
      ).toBe(0);
    }
    expect(dataKeys(h)).toEqual([]);
    expect(await h.rpc.workspaceStatus(tid)).toBeNull();
    expect(allMail(h).filter(m => m.template === 'archive_ready')).toHaveLength(
      1,
    );
  }

  it('"delete now" while purging: ZIP gone at once, the saga still deletes data and account', async () => {
    await tickUntil('mailed');
    await h.services.saga.tick(); // first purge step
    expect((await ledger(h, tid))!.phase).toBe('purging');
    await h.rpc.deleteArchiveByToken(tokenOf(h));
    expect(dataKeys(h)).toEqual([]);
    expect(await n(h, 'SELECT COUNT(*) AS n FROM archive_index')).toBe(0);
    expect((await ledger(h, tid))!.phase).toBe('purging');
    const out = await finish();
    expect(out).toContain('account_deleted');
    expect(
      out.filter(o => o !== 'idle').every(o => !o.startsWith('export')),
    ).toBe(true);
    await expectFullyDeleted();
    // No stuck backlog: nothing EXPIRED / ARCHIVING remains.
    expect(
      await n(
        h,
        "SELECT COUNT(*) AS n FROM workspace WHERE status IN ('EXPIRED','ARCHIVING')",
      ),
    ).toBe(0);
  });

  it('"delete now" right after the mail', async () => {
    await tickUntil('mailed');
    await h.rpc.deleteArchiveByToken(tokenOf(h));
    expect((await ledger(h, tid))!.phase).toBe('mailed');
    await finish();
    await expectFullyDeleted();
  });

  it('the 7-day final delete while the saga is still purging keeps the ledger', async () => {
    await tickUntil('purging');
    await h.db
      .prepare('UPDATE archive_index SET expires_at = 0 WHERE tenant_id = ?1')
      .bind(tid)
      .run();
    expect(await h.services.trials.finalDeleteDue(1)).toBe(1);
    expect((await ledger(h, tid))!.phase).toBe('purging');
    await finish();
    await expectFullyDeleted();
  });

  it('admin deletes the ZIP before the mail went out: deletion notice, no index', async () => {
    await tickUntil('exported');
    h.resend.script.push(500);
    expect(await h.services.saga.tick()).toBe('mail_failed');
    const idx = await h.services.trials['d'].archives.get(tid);
    await h.services.trials.finalDelete(idx!);
    expect(await h.services.saga.tick()).toBe('mailed');
    expect(await n(h, 'SELECT COUNT(*) AS n FROM archive_index')).toBe(0);
    expect(
      allMail(h).filter(m => m.template === 'account_deleted'),
    ).toHaveLength(1);
    await finish();
    for (const lc of Object.values(h.lifecycles))
      expect(lc.rows.get(tid) ?? 0).toBe(0);
    expect(await n(h, 'SELECT COUNT(*) AS n FROM purge_ledger')).toBe(0);
    expect(await h.rpc.workspaceStatus(tid)).toBeNull();
  });

  it('an ARCHIVING workspace whose ledger is gone is resumed without export or mail', async () => {
    await tickUntil('purging');
    const mails = allMail(h).length;
    const exports = h.lifecycles.objects.exportCalls;
    // The state the old bug left behind: index and ledger deleted.
    await h.services.trials.finalDelete(
      (await h.services.trials['d'].archives.get(tid))!,
    );
    await h.db.prepare('DELETE FROM purge_ledger').run();
    expect(await h.rpc.workspaceStatus(tid)).toEqual({
      kind: 'trial',
      status: 'ARCHIVING',
    });
    expect(await h.services.saga.tick()).toBe('resumed');
    await finish();
    expect(allMail(h)).toHaveLength(mails);
    expect(h.lifecycles.objects.exportCalls).toBe(exports);
    await expectFullyDeleted();
  });
});

describe('stuck archive steps (A2)', () => {
  it('alerts once after 24 h of failures of one step and clears on success', async () => {
    const h = await createHarness(createTestD1('identity-access'));
    const s = await signup(h, 'stuck@example.com');
    const tid = s.me.workspace.tenantId;
    h.lifecycles.objects.rows.set(tid, 3);
    const stuck = () =>
      h.services.admin['d'].flags.countPrefix(
        ARCHIVE_FAIL_PREFIX,
        h.clock.now().getTime() - ARCHIVE_STUCK_AFTER_MS,
      );
    h.clock.advance(72 * HOUR_MS);
    await runCron(h.services, h.clock.now());
    h.clock.advance(16 * MINUTE_MS);
    expect(await h.services.saga.tick()).toBe('created');
    h.lifecycles.ontology.failNext(10_000);
    for (let i = 0; i < 26; i++) {
      expect(await h.services.saga.tick()).toBe('failed');
      if (i === 20) expect(await stuck()).toBe(0);
      h.clock.advance(HOUR_MS);
    }
    const alerts = h.logger.lines.filter(l => l.msg === 'archive.step_stuck');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].level).toBe('error');
    expect(alerts[0].fields).toMatchObject({tid, phase: 'exporting'});
    expect(JSON.stringify(alerts)).not.toContain('stuck@');
    const counted = await h.db
      .prepare(
        "SELECT SUM(value) AS n FROM usage_counter WHERE key = 'archive_stuck'",
      )
      .first<{n: number}>();
    expect(counted!.n).toBe(1);
    expect(await stuck()).toBe(1);
    h.lifecycles.ontology.clearFailures();
    expect(await h.services.saga.tick()).toBe('export:ontology');
    expect((await ledger(h, tid))!.attempts).toBe(0);
    expect(await stuck()).toBe(0);
    expect(await n(h, 'SELECT COUNT(*) AS n FROM system_flag')).toBe(0);
  });
});

describe('archive size limits (A3)', () => {
  it('caps staging parts at 20 and truncates the ZIP to 2 MB with a manifest note', async () => {
    const h = await createHarness(createTestD1('identity-access'));
    const s = await signup(h, 'big@example.com');
    const tid = s.me.workspace.tenantId;
    h.lifecycles.objects.rows.set(tid, 1);
    h.lifecycles.decision.rows.set(tid, 1);
    const line = JSON.stringify({pad: 'x'.repeat(1000)});
    const page = Array.from({length: 300}, () => line).join('\n') + '\n';
    let pages = 0;
    h.lifecycles.objects.exportTenant = async () => {
      pages++;
      return {file: 'objects.jsonl', text: page, nextCursor: 'more'};
    };
    h.clock.advance(72 * HOUR_MS);
    await runCron(h.services, h.clock.now());
    h.clock.advance(16 * MINUTE_MS);
    for (let i = 0; i < 40; i++) {
      await h.services.saga.tick();
      if ((await ledger(h, tid))!.phase !== 'exporting') break;
    }
    const led = (await ledger(h, tid))!;
    expect(led.phase).toBe('exported');
    expect(led.parts).toBeLessThanOrEqual(20);
    expect(pages).toBe(20 - 2 - 2); // ontology, integration before; situation, decision after
    const zip = (await h.blobs.get(led.objectKey!))!;
    expect(zip.byteLength).toBeLessThanOrEqual(2 * 1024 * 1024);
    const files = unzipSync(zip);
    const manifest = JSON.parse(fromUtf8(files['manifest.json']));
    const objects = manifest.files.find(
      (f: {name: string}) => f.name === 'objects.jsonl',
    );
    expect(objects.truncated).toBe(true);
    expect(manifest.notes).toHaveLength(1);
    const text = fromUtf8(files['objects.jsonl']);
    for (const l of text.split('\n').filter(Boolean)) JSON.parse(l);
    expect(objects.records).toBe(text.split('\n').filter(Boolean).length);
    expect(Object.keys(files)).toContain('decisions.json');
    // The saga continues normally.
    expect(await h.services.saga.tick()).toBe('mailed');
  });
});
