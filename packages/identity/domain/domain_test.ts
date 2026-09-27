/**
 * @fileoverview Unit tests of the identity-access domain rules.
 */

import {describe, expect, it} from 'vitest';
import {
  MAX_STAGING_PARTS,
  TRUNCATED_JSON,
  fitToBudget,
  isLastAllowedPart,
  passkeySetupIncomplete,
  recoveryPending,
  truncateText,
} from './index';
import {
  ARCHIVE_README,
  EXPORT_DONE,
  GENESIS_HASH,
  OTP,
  admissionRefusal,
  advanceExport,
  advancePurge,
  archiveDue,
  archiveObjectKey,
  assembleFiles,
  auditKind,
  buildManifest,
  canResend,
  challengeOf,
  chooseMode,
  computeRowHash,
  countRecords,
  crossesAutoClose,
  currentExportService,
  currentPurgeService,
  decodePart,
  domainCandidates,
  effectiveCap,
  encodePart,
  formatInstant,
  formatSize,
  generateCode,
  generateRecoveryCode,
  isDisposableDomain,
  maskEmail,
  normalizeEmail,
  normalizeRecoveryCode,
  onFailure,
  renderEmail,
  sessionExpiry,
  shouldSwitch,
  signCountOk,
  signupState,
  trialUsable,
  verifyChain,
  type AdmissionSnapshot,
  type AuditRow,
  type Ledger,
} from './index';
import {base64url, utf8} from '@ontodecide/shared-kernel';

const HOUR = 3_600_000;

describe('email address', () => {
  it('normalizes and finds parent domains', () => {
    expect(normalizeEmail('  Foo@Example.COM ')).toBe('foo@example.com');
    expect(domainCandidates('a.b.example.com')).toEqual([
      'a.b.example.com',
      'b.example.com',
      'example.com',
    ]);
    expect(isDisposableDomain('x.mailinator.com')).toBe(true);
    expect(isDisposableDomain('example.com')).toBe(false);
    expect(maskEmail('alice@example.com')).toBe('a***@example.com');
  });
});

describe('otp', () => {
  it('generates 6 digits and rejects biased values', () => {
    let calls = 0;
    const code = generateCode(() => {
      calls++;
      // First draw is above the rejection limit, second is 123456.
      return calls === 1
        ? new Uint8Array([0xff, 0xff, 0xff, 0xff])
        : new Uint8Array([0, 1, 0xe2, 0x40]);
    });
    expect(code).toBe('123456');
    expect(calls).toBe(2);
    expect(generateCode()).toMatch(/^\d{6}$/);
  });

  it('throttles resends for 60 s', () => {
    const now = 1_000_000;
    expect(canResend(null, now)).toBe(true);
    expect(canResend(now + OTP.ttlMs - 30_000, now)).toBe(false);
    expect(canResend(now + OTP.ttlMs - 60_000, now)).toBe(true);
  });

  it('drops the code on the 5th failure and locks on the 10th', () => {
    expect(onFailure(4, 4, 0)).toEqual({dropCode: false, lockUntil: null});
    expect(onFailure(5, 5, 0).dropCode).toBe(true);
    expect(onFailure(1, 10, 7).lockUntil).toBe(7 + OTP.lockMs);
  });
});

describe('sessions', () => {
  it('caps owner sessions by the trial end and admin by 8 h', () => {
    const now = 0;
    expect(
      sessionExpiry({
        role: 'owner',
        now,
        trialExpiresAt: 10 * HOUR,
        trialHours: 72,
        adminSessionHours: 8,
      }),
    ).toBe(10 * HOUR);
    expect(
      sessionExpiry({
        role: 'owner',
        now,
        trialExpiresAt: 100 * HOUR,
        trialHours: 72,
        adminSessionHours: 8,
      }),
    ).toBe(72 * HOUR);
    expect(
      sessionExpiry({
        role: 'admin',
        now,
        trialExpiresAt: null,
        trialHours: 72,
        adminSessionHours: 8,
      }),
    ).toBe(8 * HOUR);
    expect(trialUsable('ACTIVE', 10, 5)).toBe(true);
    expect(trialUsable('ACTIVE', 5, 5)).toBe(false);
    expect(trialUsable('EXPIRED', 10, 5)).toBe(false);
  });
});

describe('admission', () => {
  const ok: AdmissionSnapshot = {
    signupEnabled: true,
    signupDailyLimit: 20,
    signupsToday: 0,
    activeWorkspaceLimit: 60,
    activeTrials: 0,
    purgeBacklog: 0,
    purgeBacklogLimit: 10,
    autoClosed: false,
    signupsFromIpToday: 0,
  };
  it('admits and refuses for each reason', () => {
    expect(admissionRefusal(ok)).toBeNull();
    expect(admissionRefusal({...ok, signupEnabled: false})).toBe('paused');
    expect(admissionRefusal({...ok, autoClosed: true})).toBe('auto_closed');
    expect(admissionRefusal({...ok, signupsToday: 20})).toBe('daily_limit');
    expect(admissionRefusal({...ok, activeTrials: 60})).toBe('active_limit');
    expect(admissionRefusal({...ok, purgeBacklog: 10})).toBe('purge_backlog');
    expect(admissionRefusal({...ok, signupsFromIpToday: 2})).toBe('ip_limit');
    expect(signupState(true, false)).toBe('open');
    expect(signupState(false, true)).toBe('paused');
    expect(signupState(true, true)).toBe('auto_closed');
  });

  it('waits 16 minutes after expiry before archiving', () => {
    expect(archiveDue(0, 15 * 60_000, 16)).toBe(false);
    expect(archiveDue(0, 16 * 60_000, 16)).toBe(true);
  });
});

describe('archive saga transitions', () => {
  const base: Ledger = {
    tenantId: 't',
    phase: 'exporting',
    mode: 'archive',
    objectKey: archiveObjectKey('t', 'ab'),
    exportSvc: null,
    exportCursor: null,
    parts: 0,
    sizeBytes: null,
    sha256: null,
    purgeSvc: null,
    locale: 'zh-CN',
    timeZone: 'Asia/Shanghai',
    expiredAt: 0,
    mailed: null,
    attempts: 0,
    updatedAt: 0,
  };

  it('walks the export order and then DONE', () => {
    expect(base.objectKey).toBe('archives/t/ab.zip');
    expect(currentExportService(base)).toBe('ontology');
    expect(advanceExport('objects', 'c2')).toEqual({
      exportSvc: 'objects',
      exportCursor: 'c2',
    });
    expect(advanceExport('ontology', null)).toEqual({
      exportSvc: 'integration',
      exportCursor: null,
    });
    expect(advanceExport('decision', null)).toEqual({
      exportSvc: EXPORT_DONE,
      exportCursor: null,
    });
    expect(currentExportService({...base, exportSvc: EXPORT_DONE})).toBeNull();
  });

  it('walks the purge order and ends purged', () => {
    expect(currentPurgeService(base)).toBe('situation');
    expect(advancePurge('situation', false)).toEqual({
      phase: 'purging',
      purgeSvc: 'situation',
    });
    expect(advancePurge('situation', true)).toEqual({
      phase: 'purging',
      purgeSvc: 'decision',
    });
    expect(advancePurge('ontology', true)).toEqual({
      phase: 'purged',
      purgeSvc: 'ontology',
    });
  });

  it('chooses the mode', () => {
    expect(chooseMode('no_archive', 10)).toBe('no_archive');
    expect(chooseMode(null, 0)).toBe('empty');
    expect(chooseMode('archive', 3)).toBe('archive');
  });

  it('encodes parts and assembles JSON Lines pages', () => {
    const p = decodePart(encodePart('objects.jsonl', '{"n":1}\n'));
    expect(p).toEqual({file: 'objects.jsonl', text: '{"n":1}\n'});
    const files = assembleFiles([
      {file: 'objects.jsonl', text: '{"n":1}'},
      {file: 'objects.jsonl', text: '{"n":2}\n'},
      {file: 'ontology.json', text: '{"a":1}'},
    ]);
    expect(files.get('objects.jsonl')).toBe('{"n":1}\n{"n":2}\n');
    expect(countRecords('objects.jsonl', files.get('objects.jsonl')!)).toBe(2);
    expect(countRecords('decisions.json', '[1,2,3]')).toBe(3);
    expect(countRecords('ontology.json', '{"a":1}')).toBe(1);
    const m = buildManifest([], new Date(0));
    expect(m.formatVersion).toBe(1);
    expect(JSON.stringify(m)).not.toContain('@');
    expect(ARCHIVE_README).toContain('[中文]');
    expect(ARCHIVE_README).toContain('[English]');
  });
});

describe('audit chain', () => {
  it('verifies and detects tampering', async () => {
    const rows: AuditRow[] = [];
    let prev = GENESIS_HASH;
    for (let i = 0; i < 3; i++) {
      const c = {
        id: `id${i}`,
        at: i,
        action: 'user.patch',
        targetTenantId: 't',
        targetUserId: null,
        reason: `r${i}`,
        idempotencyKey: null,
        result: null,
      };
      const rowHash = await computeRowHash(prev, c);
      rows.push({...c, prevHash: prev, rowHash});
      prev = rowHash;
    }
    expect(await verifyChain(rows)).toBe(true);
    expect(
      await verifyChain([{...rows[0], reason: 'x'}, ...rows.slice(1)]),
    ).toBe(false);
    expect(await verifyChain([rows[0], rows[2]])).toBe(false);
    expect(auditKind('act_as.enter')).toBe('enter');
    expect(auditKind('archive.delete')).toBe('delete');
    expect(auditKind('email.view')).toBe('view');
    expect(auditKind('settings.update')).toBe('modify');
  });
});

describe('mail routing rules', () => {
  it('reserves 15 sends for codes and switches only on 429 / 5xx', () => {
    expect(effectiveCap(90, 'otp')).toBe(90);
    expect(effectiveCap(90, 'normal')).toBe(75);
    expect(shouldSwitch(429)).toBe(true);
    expect(shouldSwitch(503)).toBe(true);
    expect(shouldSwitch(422)).toBe(false);
    expect(crossesAutoClose({d1Writes: 80_000})).toBe(true);
    expect(crossesAutoClose({d1Writes: 79_999, workers: 10})).toBe(false);
  });
});

describe('passkey helpers', () => {
  it('reads challenges, normalizes recovery codes and checks counters', () => {
    const cred = {
      id: 'c',
      response: {
        clientDataJSON: base64url(utf8(JSON.stringify({challenge: 'abc'}))),
      },
    };
    expect(challengeOf(cred)).toBe('abc');
    expect(challengeOf({response: {clientDataJSON: '!!'}})).toBeNull();
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(normalizeRecoveryCode(code.toLowerCase())).toBe(
      code.replace(/-/g, ''),
    );
    expect(signCountOk(0, 0)).toBe(true);
    expect(signCountOk(5, 6)).toBe(true);
    expect(signCountOk(5, 5)).toBe(false);
    expect(signCountOk(5, 3)).toBe(false);
  });
});

describe('email templates', () => {
  it('formats instants in the user time zone', () => {
    const ms = Date.parse('2026-10-07T06:20:00Z');
    expect(formatInstant(ms, 'zh-CN', 'Asia/Shanghai')).toBe(
      '2026-10-07 14:20（北京时间）',
    );
    expect(formatInstant(ms, 'en-US', 'Asia/Shanghai')).toBe(
      'Oct 7, 2026 14:20 (UTC+8)',
    );
    expect(formatInstant(ms, 'en-US', 'Not/AZone')).toContain('(UTC)');
    expect(formatSize(412 * 1024)).toBe('412 KB');
  });

  it('renders every template in both languages', () => {
    for (const locale of ['zh-CN', 'en-US'] as const) {
      expect(
        renderEmail('code_signup', locale, {code: '123456'}).subject,
      ).toContain('123456');
      expect(
        renderEmail('code_login', locale, {code: '654321'}).text,
      ).toContain('654321');
      expect(
        renderEmail('code_terminate', locale, {code: '111111'}).html,
      ).toContain('111111');
      const rem = renderEmail('trial_reminder', locale, {
        expiresAt: 0,
        timeZone: 'UTC',
        appOrigin: 'https://app.test',
      });
      expect(rem.text).toMatch(/只会发送一次|sent only once/);
      const ready = renderEmail('archive_ready', locale, {
        url: 'https://b2/x?sig=1&a=2',
        deleteUrl: 'https://app.test/archive-deletions/tok',
        sizeBytes: 412 * 1024,
        sha256: '9f2c' + '0'.repeat(56) + 'a41e',
        expiresAt: 0,
        timeZone: 'Asia/Shanghai',
      });
      expect(ready.html).toContain('https://b2/x?sig=1&amp;a=2');
      expect(ready.html).toContain('https://app.test/archive-deletions/tok');
      expect(ready.html).toContain('412 KB');
      expect(ready.html).toContain('9f2c…a41e');
      expect(ready.html).toContain('manifest.json');
      expect(ready.text).toMatch(/请勿转发|Do not forward/);
      expect(
        renderEmail('account_deleted', locale, {reason: 'empty'}).subject,
      ).toBeTruthy();
      expect(
        renderEmail('admin_new_device', locale, {
          at: 0,
          timeZone: 'UTC',
          client: '<b>',
          method: 'passkey',
        }).html,
      ).toContain('&lt;b&gt;');
      expect(
        renderEmail('admin_pending_change', locale, {
          kind: 'email',
          effectiveAt: 0,
          timeZone: 'UTC',
        }).text,
      ).toBeTruthy();
    }
  });
});

describe('archive limits', () => {
  it('reserves one staging part for every later service', () => {
    // objects is followed by situation and decision.
    expect(isLastAllowedPart('objects', MAX_STAGING_PARTS - 4)).toBe(false);
    expect(isLastAllowedPart('objects', MAX_STAGING_PARTS - 3)).toBe(true);
    expect(isLastAllowedPart('decision', MAX_STAGING_PARTS - 1)).toBe(true);
    expect(isLastAllowedPart('ontology', 0)).toBe(false);
  });

  it('marks truncated staging parts', () => {
    expect(decodePart(encodePart('objects.jsonl', 'a\n', true))).toEqual({
      file: 'objects.jsonl',
      text: 'a\n',
      truncated: true,
    });
    expect(decodePart(encodePart('objects.jsonl', 'a\n'))).toEqual({
      file: 'objects.jsonl',
      text: 'a\n',
    });
  });

  it('truncates whole JSON Lines and replaces oversize JSON', () => {
    expect(truncateText('objects.jsonl', '{"a":1}\n{"b":2}\n', 9)).toBe(
      '{"a":1}\n',
    );
    expect(truncateText('ontology.json', '{"x":"yyyy"}', 5)).toBe(
      TRUNCATED_JSON,
    );
    expect(truncateText('ontology.json', '{}', 5)).toBe('{}');
  });

  it('cuts the largest files until the total fits', () => {
    const big = Array.from({length: 100}, (_, i) => `{"n":${i}}`).join('\n');
    const files = new Map<'objects.jsonl' | 'links.jsonl', string>([
      ['objects.jsonl', big],
      ['links.jsonl', '{"l":1}\n'],
    ]);
    const fit = fitToBudget(files, 200);
    const total = [...fit.files.values()].reduce(
      (a, t) => a + new TextEncoder().encode(t).byteLength,
      0,
    );
    expect(total).toBeLessThanOrEqual(200);
    expect([...fit.truncated]).toEqual(['objects.jsonl']);
    expect(fit.files.get('links.jsonl')).toBe('{"l":1}\n');
    expect(fitToBudget(files, 10_000).truncated.size).toBe(0);
    const m = buildManifest(
      [
        {
          name: 'objects.jsonl',
          records: 1,
          bytes: 1,
          sha256: 'x',
          truncated: true,
        },
      ],
      new Date(0),
    );
    expect(m.notes).toHaveLength(1);
    expect(buildManifest([], new Date(0)).notes).toBeUndefined();
  });
});

describe('admin session gate rules', () => {
  it('recovery pending until a passkey is in amr; setup needs 2 passkeys + codes', () => {
    expect(recoveryPending(['otp', 'recovery'])).toBe(true);
    expect(recoveryPending(['otp', 'passkey'])).toBe(false);
    expect(recoveryPending(['otp'])).toBe(false);
    expect(passkeySetupIncomplete(1, 10)).toBe(true);
    expect(passkeySetupIncomplete(2, 0)).toBe(true);
    expect(passkeySetupIncomplete(2, 10)).toBe(false);
    expect(auditKind('admin.login')).toBe('enter');
  });
});
