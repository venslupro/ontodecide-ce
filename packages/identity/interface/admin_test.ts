/**
 * @fileoverview Bootstrap admin, passkeys, recovery codes, step-up and the
 * PlatformAdmin use cases (详细设计 表 14 安全 / 并发与逻辑).
 */

import {beforeEach, describe, expect, it} from 'vitest';
import {
  AppError,
  HOUR_MS,
  publicJwkOf,
  sha256Hex,
  verifyJwt,
  type AccessClaims,
  type CallCtx,
} from '@ontodecide/shared-kernel';
import {SqliteD1, createTestD1} from '@ontodecide/testing';
import type {IssuedSession} from '../contract';
import {FakeWebAuthn} from '../infrastructure';
import {
  ADMIN_EMAIL,
  SETUP_CODE,
  adminPreAuth,
  allMail,
  challengeOfOptions,
  createHarness,
  lastCode,
  signup,
  type Harness,
} from './test_fixtures';

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return AppError.from(e).code;
  }
}

function ctxOf(s: IssuedSession): CallCtx {
  return {
    tid: s.me.workspace.tenantId,
    sub: s.me.userId,
    actor: {role: s.me.role, userId: s.me.userId, actingAs: false},
    requestId: 'r',
    locale: 'zh-CN',
  };
}

const KEY = (n: number | string) => `idem-key-000000-${n}`;

/** Admin with its first passkey `pk1` (counter 1). */
async function setupAdmin(
  h: Harness,
): Promise<{session: IssuedSession; ctx: CallCtx}> {
  const pre = await adminPreAuth(h);
  const opts = await h.rpc.passkeySetupOptions(pre.preAuth, SETUP_CODE);
  const cred = FakeWebAuthn.credential('pk1', challengeOfOptions(opts), {
    type: 'create',
    counter: 1,
  });
  const r = await h.rpc.passkeySetup(pre.preAuth, SETUP_CODE, cred, {
    ip: '1',
    client: 'Safari · macOS',
  });
  return {session: r.session!, ctx: ctxOf(r.session!)};
}

let counter = 10;
async function stepUp(h: Harness, ctx: CallCtx, id = 'pk1'): Promise<string> {
  const o = await h.rpc.passkeyOptions({ctx}, 'step_up');
  const r = await h.rpc.passkeyAssertion(
    {ctx},
    'step_up',
    FakeWebAuthn.credential(id, challengeOfOptions(o), {counter: counter++}),
    {ip: '1'},
  );
  if (!('stepUpToken' in r)) throw new Error('expected step-up');
  return r.stepUpToken;
}

async function addPasskey(h: Harness, ctx: CallCtx, id: string, su: string) {
  const o = await h.rpc.adminPasskeyOptions(ctx);
  return h.rpc.adminAddPasskey(
    ctx,
    FakeWebAuthn.credential(id, challengeOfOptions(o), {type: 'create'}),
    id,
    su,
  );
}

describe('bootstrap admin', () => {
  it('is created once, even concurrently, and never expires', async () => {
    const db = createTestD1('identity-access');
    const a = await createHarness(db);
    const b = await createHarness(db);
    await Promise.all([
      a.services.bootstrap.ensure(),
      b.services.bootstrap.ensure(),
    ]);
    await a.services.bootstrap.ensure();
    const n = await db
      .prepare("SELECT COUNT(*) AS n FROM user_account WHERE role = 'admin'")
      .first<{n: number}>();
    expect(n!.n).toBe(1);
    const w = await db
      .prepare("SELECT * FROM workspace WHERE kind = 'admin'")
      .first<{trial_expires_at: null; status: string}>();
    expect(w).toMatchObject({trial_expires_at: null, status: 'ACTIVE'});
  });

  it('database triggers refuse deleting, demoting or expiring the admin', async () => {
    const h = await createHarness(createTestD1('identity-access'));
    await h.services.bootstrap.ensure();
    const run = (sql: string) => code(h.db.prepare(sql).run());
    expect(await run("DELETE FROM user_account WHERE role = 'admin'")).not.toBe(
      'OK',
    );
    expect(
      await run("UPDATE user_account SET role = 'owner' WHERE role = 'admin'"),
    ).not.toBe('OK');
    expect(
      await run("UPDATE workspace SET status = 'EXPIRED' WHERE kind = 'admin'"),
    ).not.toBe('OK');
    expect(
      await run(
        "UPDATE workspace SET trial_expires_at = 1 WHERE kind = 'admin'",
      ),
    ).not.toBe('OK');
    expect(await run("DELETE FROM workspace WHERE kind = 'admin'")).not.toBe(
      'OK',
    );
  });
});

describe('admin sign-in and passkeys', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness(createTestD1('identity-access'));
  });

  it('requires the setup code for the first passkey, once', async () => {
    const pre = await adminPreAuth(h);
    expect(pre.setupRequired).toBe(true);
    expect(
      await code(h.rpc.passkeySetupOptions(pre.preAuth, 'wrong-setup-code')),
    ).toBe('FORBIDDEN');
    expect(
      await code(h.rpc.passkeyOptions({preAuth: pre.preAuth}, 'login')),
    ).toBe('FORBIDDEN');
    const {session} = await setupAdmin(h);
    expect(session.amr).toEqual(['otp', 'passkey']);
    const c = await verifyJwt<AccessClaims>(
      session.accessToken,
      [publicJwkOf(h.config.signingKey)],
      Math.floor(h.clock.now().getTime() / 1000),
    );
    expect(c.role).toBe('admin');
    expect(c.texp).toBeUndefined();
    expect(session.refreshExpiresAt - h.clock.now().getTime()).toBe(
      8 * HOUR_MS,
    );
    expect(await h.rpc.verifyAdminSession(c.sid)).toBe(true);
    expect(allMail(h).some(m => m.template === 'admin_new_device')).toBe(true);
    // The setup code is consumed.
    const pre2 = await adminPreAuth(h);
    expect(pre2.setupRequired).toBe(false);
    expect(
      await code(h.rpc.passkeySetupOptions(pre2.preAuth, SETUP_CODE)),
    ).toBe('FORBIDDEN');
    // A pre-auth token is not an access token and vice versa.
    expect(
      await code(h.rpc.passkeyOptions({preAuth: session.accessToken}, 'login')),
    ).toBe('UNAUTHENTICATED');
  });

  it('signs in with a passkey and rejects a regressed sign counter', async () => {
    await setupAdmin(h);
    const pre = await adminPreAuth(h);
    const o = await h.rpc.passkeyOptions({preAuth: pre.preAuth}, 'login');
    const r = await h.rpc.passkeyAssertion(
      {preAuth: pre.preAuth},
      'login',
      FakeWebAuthn.credential('pk1', challengeOfOptions(o), {counter: 5}),
      {ip: '1'},
    );
    expect('kind' in r && r.kind).toBe('session');
    const o2 = await h.rpc.passkeyOptions({preAuth: pre.preAuth}, 'login');
    expect(
      await code(
        h.rpc.passkeyAssertion(
          {preAuth: pre.preAuth},
          'login',
          FakeWebAuthn.credential('pk1', challengeOfOptions(o2), {counter: 3}),
          {ip: '1'},
        ),
      ),
    ).toBe('UNAUTHENTICATED');
    // Challenges are single-use.
    expect(
      await code(
        h.rpc.passkeyAssertion(
          {preAuth: pre.preAuth},
          'login',
          FakeWebAuthn.credential('pk1', challengeOfOptions(o), {counter: 9}),
          {ip: '1'},
        ),
      ),
    ).toBe('UNAUTHENTICATED');
    // Without user verification.
    const o3 = await h.rpc.passkeyOptions({preAuth: pre.preAuth}, 'login');
    expect(
      await code(
        h.rpc.passkeyAssertion(
          {preAuth: pre.preAuth},
          'login',
          FakeWebAuthn.credential('pk1', challengeOfOptions(o3), {
            counter: 20,
            userVerified: false,
          }),
          {ip: '1'},
        ),
      ),
    ).toBe('UNAUTHENTICATED');
  });

  it('returns 10 recovery codes with the 2nd passkey and keeps ≥ 2 passkeys', async () => {
    const {ctx} = await setupAdmin(h);
    expect(await code(addPasskey(h, ctx, 'pk2', ''))).toBe('FORBIDDEN');
    const r2 = await addPasskey(h, ctx, 'pk2', await stepUp(h, ctx));
    expect(r2.total).toBe(2);
    expect(r2.recoveryCodes).toHaveLength(10);
    const stored = await h.db
      .prepare('SELECT code_hash FROM admin_recovery_code')
      .all<{code_hash: string}>();
    expect(stored.results.map(x => x.code_hash)).not.toContain(
      r2.recoveryCodes![0],
    );
    expect(
      await code(h.rpc.adminDeletePasskey(ctx, 'pk2', await stepUp(h, ctx))),
    ).toBe('CONFLICT');
    const r3 = await addPasskey(h, ctx, 'pk3', await stepUp(h, ctx));
    expect(r3.recoveryCodes).toBeUndefined();
    expect(await code(h.rpc.adminDeletePasskey(ctx, 'pk3', ''))).toBe(
      'FORBIDDEN',
    );
    await h.rpc.adminDeletePasskey(ctx, 'pk3', await stepUp(h, ctx));
    expect((await h.rpc.adminListPasskeys(ctx)).map(p => p.id)).toEqual([
      'pk1',
      'pk2',
    ]);
    const me = await h.rpc.getMe(ctx);
    expect(me).toMatchObject({passkeys: 2, recoveryCodesLeft: 10});
  });

  it('accepts each recovery code once; a new passkey may follow without step-up', async () => {
    const {ctx} = await setupAdmin(h);
    const {recoveryCodes} = await addPasskey(
      h,
      ctx,
      'pk2',
      await stepUp(h, ctx),
    );
    const pre = await adminPreAuth(h);
    const s = await h.rpc.recoveryLogin(
      pre.preAuth,
      recoveryCodes![0].toLowerCase(),
      {ip: '1'},
    );
    expect(s.amr).toEqual(['otp', 'recovery']);
    expect(
      await code(
        h.rpc.recoveryLogin(pre.preAuth, recoveryCodes![0], {ip: '1'}),
      ),
    ).toBe('UNAUTHENTICATED');
    expect(
      await code(h.rpc.recoveryLogin(pre.preAuth, 'AAAA-BBBB-CCCC', {ip: '1'})),
    ).toBe('UNAUTHENTICATED');
    const r = await addPasskey(h, ctxOf(s), 'pk-new', '');
    expect(r.total).toBe(3);
  });

  it('step-up tokens expire after 5 minutes and are bound to the admin', async () => {
    const {ctx} = await setupAdmin(h);
    const owner = await signup(h, 'o@example.com');
    const su = await stepUp(h, ctx);
    h.clock.advance(5 * 60_000 + 1000);
    expect(
      await code(
        h.rpc.adminPatchUser(
          ctx,
          owner.me.userId,
          {banned: true, reason: 'x'},
          su,
          KEY(1),
        ),
      ),
    ).toBe('FORBIDDEN');
    expect(
      await code(h.rpc.passkeyOptions({ctx: ctxOf(owner)}, 'step_up')),
    ).toBe('FORBIDDEN');
  });
});

describe('platform administration', () => {
  let h: Harness;
  let admin: CallCtx;
  let owner: IssuedSession;

  beforeEach(async () => {
    h = await createHarness(createTestD1('identity-access'));
    admin = (await setupAdmin(h)).ctx;
    owner = await signup(h, 'owner@example.com');
  });

  it('owners and missing step-ups are refused', async () => {
    const o = ctxOf(owner);
    expect(await code(h.rpc.adminOverview(o))).toBe('FORBIDDEN');
    expect(await code(h.rpc.adminListUsers(o, {}, {}))).toBe('FORBIDDEN');
    expect(
      await code(
        h.rpc.audit(o, {action: 'tenant.write', targetTenantId: o.tid}),
      ),
    ).toBe('FORBIDDEN');
    expect(
      await code(
        h.rpc.adminDeleteUser(
          admin,
          owner.me.userId,
          {archive: true, reason: 'x'},
          '',
          KEY(2),
        ),
      ),
    ).toBe('FORBIDDEN');
    expect(
      await code(
        h.rpc.adminPatchSettings(admin, {signupEnabled: false}, 0, '', KEY(3)),
      ),
    ).toBe('FORBIDDEN');
  });

  it('the admin cannot be patched, deleted, expired or terminate', async () => {
    const su = await stepUp(h, admin);
    const uid = admin.sub;
    expect(
      await code(
        h.rpc.adminPatchUser(
          admin,
          uid,
          {status: 'EXPIRED', reason: 'x'},
          su,
          KEY(4),
        ),
      ),
    ).toBe('FORBIDDEN');
    expect(
      await code(
        h.rpc.adminDeleteUser(
          admin,
          uid,
          {archive: false, reason: 'x'},
          su,
          KEY(5),
        ),
      ),
    ).toBe('FORBIDDEN');
    expect(await code(h.rpc.terminateTrial(admin, '123456'))).toBe('FORBIDDEN');
    expect(await code(h.rpc.sendMeCode(admin, 'terminate'))).toBe('FORBIDDEN');
    expect(await h.rpc.workspaceStatus(admin.tid)).toEqual({
      kind: 'admin',
      status: 'ACTIVE',
    });
  });

  it('changing the trial revokes sessions; the next sign-in carries the new end', async () => {
    const newEnd = h.clock.now().getTime() + 100 * HOUR_MS;
    const dto = await h.rpc.adminPatchUser(
      admin,
      owner.me.userId,
      {trialExpiresAt: new Date(newEnd).toISOString(), reason: 'extend'},
      await stepUp(h, admin),
      KEY(6),
    );
    expect(dto.trialExpiresAt).toBe(new Date(newEnd).toISOString());
    expect(dto.sessions).toBe(0);
    expect(await code(h.rpc.refresh(owner.refreshToken, {ip: '1'}))).toBe(
      'UNAUTHENTICATED',
    );
    h.clock.advance(61_000);
    await h.rpc.sendCode(
      {email: 'owner@example.com', purpose: 'login', turnstileToken: 'ok'},
      {ip: '1'},
    );
    const s = await h.rpc.createSession(
      {
        email: 'owner@example.com',
        code: lastCode(h, 'owner@example.com'),
        purpose: 'login',
      },
      {ip: '1'},
    );
    if (s.kind !== 'session') throw new Error('session');
    const c = await verifyJwt<AccessClaims>(
      s.accessToken,
      [publicJwkOf(h.config.signingKey)],
      Math.floor(h.clock.now().getTime() / 1000),
    );
    expect(c.texp).toBe(Math.floor(newEnd / 1000));
  });

  it('refresh reads the latest trial end from D1', async () => {
    const newEnd = h.clock.now().getTime() + 10 * HOUR_MS;
    await h.db
      .prepare(
        'UPDATE workspace SET trial_expires_at = ?2 WHERE tenant_id = ?1',
      )
      .bind(owner.me.workspace.tenantId, newEnd)
      .run();
    const r = await h.rpc.refresh(owner.refreshToken, {ip: '1'});
    const c = await verifyJwt<AccessClaims>(
      r.accessToken,
      [publicJwkOf(h.config.signingKey)],
      Math.floor(h.clock.now().getTime() / 1000),
    );
    expect(c.texp).toBe(Math.floor(newEnd / 1000));
    expect(r.refreshExpiresAt).toBe(newEnd);
  });

  it('ends a trial, bans (blocked_email) and revokes sessions idempotently', async () => {
    const r1 = await h.rpc.adminRevokeSessions(admin, owner.me.userId, KEY(7));
    const r2 = await h.rpc.adminRevokeSessions(admin, owner.me.userId, KEY(7));
    expect(r1).toEqual({revoked: 1});
    expect(r2).toEqual({revoked: 1});
    const rows = await h.db
      .prepare(
        "SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'sessions.revoke'",
      )
      .first<{n: number}>();
    expect(rows!.n).toBe(1);
    const dto = await h.rpc.adminPatchUser(
      admin,
      owner.me.userId,
      {status: 'EXPIRED', banned: true, reason: 'abuse'},
      await stepUp(h, admin),
      KEY(8),
    );
    expect(dto).toMatchObject({status: 'EXPIRED', banned: true});
    expect(h.lifecycles.situation.closed.map(c => c.code)).toEqual([4401]);
    const before = allMail(h).length;
    h.clock.advance(61_000);
    await h.rpc.sendCode(
      {email: 'owner@example.com', purpose: 'login', turnstileToken: 'ok'},
      {ip: '1'},
    );
    expect(allMail(h).length).toBe(before);
  });

  it('deletes a user without archive (delete_mode + EXPIRED)', async () => {
    await h.rpc.adminDeleteUser(
      admin,
      owner.me.userId,
      {archive: false, reason: 'spam'},
      await stepUp(h, admin),
      KEY(9),
    );
    const w = await h.db
      .prepare('SELECT status, delete_mode FROM workspace WHERE tenant_id = ?1')
      .bind(owner.me.workspace.tenantId)
      .first();
    expect(w).toEqual({status: 'EXPIRED', delete_mode: 'no_archive'});
    const a = await h.db
      .prepare("SELECT reason FROM admin_audit WHERE action = 'user.delete'")
      .first<{reason: string}>();
    expect(a!.reason).toBe('no_archive: spam');
    expect(
      await code(
        h.rpc.adminDeleteUser(
          admin,
          owner.me.userId,
          {archive: false, reason: ''},
          await stepUp(h, admin),
          KEY(10),
        ),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('lists users with ARCHIVE_ONLY rows, excludes the admin, audits email.view', async () => {
    await h.db
      .prepare(
        "INSERT INTO archive_index VALUES ('01K6A0000000000000000ZZZZZ', 'archives/x/y.zip', 10, 'h', 'tokhash', 0, 99999999999999)",
      )
      .run();
    const page = await h.rpc.adminListUsers(admin, {}, {limit: 1});
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const page2 = await h.rpc.adminListUsers(
      admin,
      {},
      {cursor: page.nextCursor!, limit: 10},
    );
    const all = [...page.items, ...page2.items];
    expect(all.map(r => r.status).sort()).toEqual(['ACTIVE', 'ARCHIVE_ONLY']);
    expect(all.find(r => r.status === 'ACTIVE')!.email).toBe(
      'owner@example.com',
    );
    expect(all.some(r => r.tenantId === admin.tid)).toBe(false);
    expect(
      (await h.rpc.adminListUsers(admin, {status: 'ARCHIVE_ONLY'}, {})).items,
    ).toHaveLength(1);
    expect(await code(h.rpc.adminListUsers(admin, {status: 'NOPE'}, {}))).toBe(
      'VALIDATION_FAILED',
    );
    const u = await h.rpc.adminGetUser(admin, owner.me.userId);
    expect(u).toMatchObject({
      email: 'owner@example.com',
      locale: 'zh-CN',
      archivePhase: null,
    });
    const view = await h.db
      .prepare(
        "SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'email.view'",
      )
      .first<{n: number}>();
    expect(view!.n).toBe(1);
    expect(await code(h.rpc.adminGetUser(admin, admin.sub))).toBe('NOT_FOUND');
  });

  it('archives: list, 15-minute link (audited) and delete', async () => {
    const tid = owner.me.workspace.tenantId;
    await h.db
      .prepare(
        "INSERT INTO archive_index VALUES (?1, ?2, 10, 'h', 'th', 0, 99999999999999)",
      )
      .bind(tid, `archives/${tid}/abc.zip`)
      .run();
    await h.blobs.put(`archives/${tid}/abc.zip`, 'zip');
    expect((await h.rpc.adminListArchives(admin, {})).items[0].tenantId).toBe(
      tid,
    );
    const link = await h.rpc.adminArchiveLink(admin, tid, KEY(11));
    expect(link.url).toContain('ttl=900');
    expect(Date.parse(link.expiresAt) - h.clock.now().getTime()).toBe(900_000);
    expect(await h.rpc.adminArchiveLink(admin, tid, KEY(11))).toEqual(link);
    await h.rpc.adminDeleteArchive(admin, tid, await stepUp(h, admin), KEY(12));
    expect(h.blobs.keys()).toEqual([]);
    expect(await code(h.rpc.adminArchiveLink(admin, tid, KEY(13)))).toBe(
      'NOT_FOUND',
    );
  });

  it('settings: If-Match version, ranges, idempotency', async () => {
    const s = await h.rpc.adminGetSettings(admin);
    expect(s).toMatchObject({
      signupEnabled: true,
      signupDailyLimit: 20,
      activeWorkspaceLimit: 60,
      trialHours: 72,
      archiveDays: 7,
    });
    const su = await stepUp(h, admin);
    const s2 = await h.rpc.adminPatchSettings(
      admin,
      {signupDailyLimit: 5},
      s.version,
      su,
      KEY(14),
    );
    expect(s2.signupDailyLimit).toBe(5);
    expect(s2.version).toBeGreaterThan(s.version);
    expect(
      await h.rpc.adminPatchSettings(
        admin,
        {signupDailyLimit: 5},
        s.version,
        su,
        KEY(14),
      ),
    ).toEqual(s2);
    expect(
      await code(
        h.rpc.adminPatchSettings(
          admin,
          {signupEnabled: false},
          s.version,
          su,
          KEY(15),
        ),
      ),
    ).toBe('PRECONDITION_FAILED');
    expect(
      await code(
        h.rpc.adminPatchSettings(
          admin,
          {signupDailyLimit: 21},
          s2.version,
          su,
          KEY(16),
        ),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(
      await code(h.rpc.adminRevokeSessions(admin, owner.me.userId, 'short')),
    ).toBe('VALIDATION_FAILED');
  });

  it('blocked domains are replaced', async () => {
    const d = await h.rpc.adminPutBlockedDomains(
      admin,
      ['Spam.test', 'spam.test', 'junk.example'],
      KEY(17),
    );
    expect(d).toEqual(['junk.example', 'spam.test']);
    expect(await h.rpc.adminGetBlockedDomains(admin)).toEqual(d);
    expect(
      await code(
        h.rpc.sendCode(
          {email: 'a@x.spam.test', purpose: 'signup', turnstileToken: 'ok'},
          {ip: '8'},
        ),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('act-as audit: ≤ 1 enter per workspace per hour, every tenant.write', async () => {
    const tid = owner.me.workspace.tenantId;
    const acting = {...admin, tid, actor: {...admin.actor, actingAs: true}};
    await h.rpc.audit(acting, {action: 'act_as.enter', targetTenantId: tid});
    await h.rpc.audit(acting, {action: 'act_as.enter', targetTenantId: tid});
    await h.rpc.audit(acting, {
      action: 'tenant.write',
      targetTenantId: tid,
      reason: 'patchObject',
    });
    await h.rpc.audit(acting, {
      action: 'tenant.write',
      targetTenantId: tid,
      reason: 'patchObject',
    });
    h.clock.advance(HOUR_MS + 1);
    await h.rpc.audit(acting, {action: 'act_as.enter', targetTenantId: tid});
    const rows = await h.db
      .prepare(
        'SELECT action, COUNT(*) AS n FROM admin_audit GROUP BY action ORDER BY action',
      )
      .all<{action: string; n: number}>();
    expect(rows.results).toEqual([
      {action: 'act_as.enter', n: 2},
      {action: 'tenant.write', n: 2},
    ]);
    const overview = await h.rpc.adminOverview(admin);
    expect(overview.recentActions[0].kind).toBe('enter');
    expect(overview.activeTrials).toEqual({used: 1, limit: 60});
    expect(overview.signupsToday).toEqual({used: 1, limit: 20});
    expect(overview.signup.state).toBe('open');
    expect(
      overview.freeQuota.find(q => q.key === 'emailResend')!.used,
    ).toBeGreaterThan(0);
  });

  it('audit chain: UPDATE is refused by trigger; tampering → chainOk false', async () => {
    for (let i = 0; i < 3; i++) {
      await h.rpc.adminRevokeSessions(admin, owner.me.userId, KEY(`c${i}`));
    }
    const log = await h.rpc.adminAuditLog(admin, {limit: 2});
    expect(log.items).toHaveLength(2);
    expect(log.chainOk).toBe(true);
    expect(
      await code(h.db.prepare("UPDATE admin_audit SET reason = 'x'").run()),
    ).not.toBe('OK');
    expect(await code(h.db.prepare('DELETE FROM admin_audit').run())).not.toBe(
      'OK',
    );
    const raw = (h.db as unknown as SqliteD1).raw;
    raw.exec('DROP TRIGGER trg_audit_no_update');
    raw.exec("UPDATE admin_audit SET reason = 'forged' WHERE rowid = 2");
    expect((await h.rpc.adminAuditLog(admin, {})).chainOk).toBe(false);
  });
});

describe('controlled admin changes and anchors', () => {
  it('notifies the original address and applies after 24 h', async () => {
    const h = await createHarness(createTestD1('identity-access'));
    await setupAdmin(h);
    const now = h.clock.now().getTime();
    await h.db
      .prepare(
        `INSERT INTO admin_pending_change (id, kind, payload, requested_at, effective_at)
         VALUES ('c1', 'email', '{"email":"new-root@ontodecide.test"}', ?1, ?1)`,
      )
      .bind(now)
      .run();
    await h.services.maintenance.pendingChanges();
    const notice = allMail(h).filter(
      m => m.template === 'admin_pending_change',
    );
    expect(notice.map(m => m.to)).toEqual([ADMIN_EMAIL]);
    h.clock.advance(12 * HOUR_MS);
    await h.services.maintenance.pendingChanges();
    expect((await h.services.accounts.accounts.findAdmin())!.emailHmac).toBe(
      await h.services.accounts['secrets'].emailHmac(ADMIN_EMAIL),
    );
    h.clock.advance(13 * HOUR_MS);
    await h.services.maintenance.pendingChanges();
    const admin = await h.services.accounts.accounts.findAdmin();
    expect(admin!.emailHmac).toBe(
      await h.services.accounts['secrets'].emailHmac(
        'new-root@ontodecide.test',
      ),
    );
    const row = await h.db
      .prepare(
        "SELECT payload, applied_at FROM admin_pending_change WHERE id = 'c1'",
      )
      .first<{payload: null; applied_at: number}>();
    expect(row!.payload).toBeNull();
    // Daily audit anchor goes to B2 once.
    expect(await h.services.maintenance.auditAnchor()).toBe(true);
    expect(await h.services.maintenance.auditAnchor()).toBe(false);
    const day = h.clock.now().toISOString().slice(0, 10);
    expect(h.blobs.keys()).toContain(`audit-anchors/${day}.txt`);
    expect(await sha256Hex('x')).toHaveLength(64);
  });
});
