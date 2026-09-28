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
import {runCron} from './cron';
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

/** The `sid` claim of an access token (the gateway passes it in ctx). */
function sidOf(token: string): string {
  const payload = token.split('.')[1];
  return (
    JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      sid: string;
    }
  ).sid;
}

function ctxOf(s: IssuedSession): CallCtx {
  return {
    tid: s.me.workspace.tenantId,
    sub: s.me.userId,
    actor: {role: s.me.role, userId: s.me.userId, actingAs: false},
    requestId: 'r',
    locale: 'zh-CN',
    sid: sidOf(s.accessToken),
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

/** Admin with two passkeys (`pk1`, `pk2`) and its recovery codes. */
async function fullAdmin(
  h: Harness,
): Promise<{session: IssuedSession; ctx: CallCtx; recoveryCodes: string[]}> {
  const {session, ctx} = await setupAdmin(h);
  const r = await addPasskey(h, ctx, 'pk2', await stepUp(h, ctx));
  return {session, ctx, recoveryCodes: r.recoveryCodes!};
}

describe('platform administration', () => {
  let h: Harness;
  let admin: CallCtx;
  let owner: IssuedSession;

  beforeEach(async () => {
    h = await createHarness(createTestD1('identity-access'));
    admin = (await fullAdmin(h)).ctx;
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
    // (+10 ms: audit `at` is strictly increasing across the earlier rows.)
    h.clock.advance(HOUR_MS + 10);
    await h.rpc.audit(acting, {action: 'act_as.enter', targetTenantId: tid});
    const rows = await h.db
      .prepare(
        `SELECT action, COUNT(*) AS n FROM admin_audit
         WHERE action IN ('act_as.enter', 'tenant.write')
         GROUP BY action ORDER BY action`,
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

/** The claims of an access token (no verification; tests only). */
function claimsOf(token: string): AccessClaims {
  return JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString(),
  ) as AccessClaims;
}

async function reasonOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (e) {
    const err = AppError.from(e);
    return `${err.code}:${String(err.extras?.['reason'] ?? '')}`;
  }
}

describe('admin session gate (B2 / B3)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness(createTestD1('identity-access'));
  });

  it('fewer than 2 passkeys: only /me, passkey registration, step-up and logout', async () => {
    const {session, ctx} = await setupAdmin(h);
    const sid = sidOf(session.accessToken);
    expect(await h.rpc.adminSessionStatus(sid)).toEqual({
      valid: true,
      recoveryPending: false,
      setupIncomplete: true,
    });
    const incomplete = 'FORBIDDEN:PASSKEY_SETUP_INCOMPLETE';
    expect(await reasonOf(h.rpc.adminOverview(ctx))).toBe(incomplete);
    expect(await reasonOf(h.rpc.adminListUsers(ctx, {}, {}))).toBe(incomplete);
    expect(await reasonOf(h.rpc.adminGetSettings(ctx))).toBe(incomplete);
    expect(
      await reasonOf(
        h.rpc.audit(ctx, {action: 'act_as.enter', targetTenantId: ctx.tid}),
      ),
    ).toBe(incomplete);
    expect(await reasonOf(h.rpc.exportChunk(ctx, null))).toBe(incomplete);
    const me = await h.rpc.getMe(ctx);
    expect(me).toMatchObject({passkeys: 1, recoveryPending: false});
    expect(await h.rpc.adminListPasskeys(ctx)).toHaveLength(1);
    const r = await addPasskey(h, ctx, 'pk2', await stepUp(h, ctx));
    expect(r.recoveryCodes).toHaveLength(10);
    expect((await h.rpc.adminSessionStatus(sid)).setupIncomplete).toBe(false);
    expect(await reasonOf(h.rpc.adminOverview(ctx))).toBe('OK');
  });

  it('a recovery session reaches only its passkey routes until it binds one, then is upgraded', async () => {
    const {ctx: main, recoveryCodes} = await fullAdmin(h);
    const pre = await adminPreAuth(h);
    const s = await h.rpc.recoveryLogin(pre.preAuth, recoveryCodes[0], {
      ip: '1',
    });
    const rec = ctxOf(s);
    expect(s.me.recoveryPending).toBe(true);
    expect(await h.rpc.adminSessionStatus(rec.sid!)).toMatchObject({
      valid: true,
      recoveryPending: true,
    });
    const pending = 'FORBIDDEN:RECOVERY_PENDING';
    expect(await reasonOf(h.rpc.adminOverview(rec))).toBe(pending);
    expect(await reasonOf(h.rpc.adminAuditLog(rec, {}))).toBe(pending);
    expect(await reasonOf(h.rpc.adminDeletePasskey(rec, 'pk1', 'x'))).toBe(
      pending,
    );
    expect(await reasonOf(h.rpc.passkeyOptions({ctx: rec}, 'step_up'))).toBe(
      pending,
    );
    expect(
      await reasonOf(
        h.rpc.audit(rec, {action: 'tenant.write', targetTenantId: rec.tid}),
      ),
    ).toBe(pending);
    expect(await reasonOf(h.rpc.patchMe(rec, {locale: 'en-US'}))).toBe(pending);
    expect((await h.rpc.getMe(rec)).recoveryPending).toBe(true);
    expect(await h.rpc.adminListPasskeys(rec)).toHaveLength(2);

    // Another (passkey) session of the admin is not privileged by it.
    expect(await reasonOf(addPasskey(h, main, 'pk-other', ''))).toBe(
      'FORBIDDEN:',
    );
    expect(await reasonOf(h.rpc.adminOverview(main))).toBe('OK');

    // Binding a passkey upgrades exactly this session.
    const r = await addPasskey(h, rec, 'pk-new', '');
    expect(r.total).toBe(3);
    expect((await h.rpc.getMe(rec)).recoveryPending).toBe(false);
    expect((await h.rpc.adminSessionStatus(rec.sid!)).recoveryPending).toBe(
      false,
    );
    expect(await reasonOf(h.rpc.adminOverview(rec))).toBe('OK');
    // Further passkeys need a step-up again; the refresh carries otp+passkey.
    expect(await reasonOf(addPasskey(h, rec, 'pk-4', ''))).toBe('FORBIDDEN:');
    const refreshed = await h.rpc.refresh(s.refreshToken, {ip: '1'});
    expect(claimsOf(refreshed.accessToken).amr).toEqual(['otp', 'passkey']);
    // Logout stays possible for a pending session.
    const pre2 = await adminPreAuth(h);
    const s2 = await h.rpc.recoveryLogin(pre2.preAuth, recoveryCodes[1], {
      ip: '1',
    });
    await h.rpc.logout(ctxOf(s2), sidOf(s2.accessToken));
    expect((await h.rpc.adminSessionStatus(sidOf(s2.accessToken))).valid).toBe(
      false,
    );
  });

  it('reports the caller session expiry in /me (owner and admin)', async () => {
    const {session, ctx} = await fullAdmin(h);
    expect((await h.rpc.getMe(ctx)).sessionExpiresAt).toBe(
      new Date(session.refreshExpiresAt).toISOString(),
    );
    expect(session.me.sessionExpiresAt).toBe(
      new Date(session.refreshExpiresAt).toISOString(),
    );
    const owner = await signup(h, 'exp@example.com');
    const me = await h.rpc.getMe(ctxOf(owner));
    expect(me.sessionExpiresAt).toBe(
      new Date(owner.refreshExpiresAt).toISOString(),
    );
    expect(me.recoveryPending).toBeUndefined();
    // Without a sid (or with a foreign one) the field is omitted.
    const {sid: _drop, ...noSid} = ctxOf(owner);
    expect((await h.rpc.getMe(noSid)).sessionExpiresAt).toBeUndefined();
    expect(
      (await h.rpc.getMe({...ctxOf(owner), sid: ctx.sid})).sessionExpiresAt,
    ).toBeUndefined();
  });
});

describe('admin audit without personal data (C1 / C2)', () => {
  it('stores no e-mail or user id of the owner; replays re-read current data', async () => {
    const h = await createHarness(createTestD1('identity-access'));
    const {ctx: admin} = await fullAdmin(h);
    const owner = await signup(h, 'pii-owner@example.com');
    const uid = owner.me.userId;
    const tid = owner.me.workspace.tenantId;
    await h.rpc.adminGetUser(admin, uid);
    const su = await stepUp(h, admin);
    const at = new Date(h.clock.now().getTime() + 2 * HOUR_MS).toISOString();
    const first = await h.rpc.adminPatchUser(
      admin,
      uid,
      {trialExpiresAt: at, reason: 'extend'},
      su,
      KEY('pii-1'),
    );
    expect(first.email).toBe('pii-owner@example.com');
    const replay = await h.rpc.adminPatchUser(
      admin,
      uid,
      {trialExpiresAt: at, reason: 'extend'},
      su,
      KEY('pii-1'),
    );
    expect(replay).toEqual(first);
    await h.rpc.adminRevokeSessions(admin, uid, KEY('pii-2'));
    await h.rpc.adminDeleteUser(
      admin,
      uid,
      {archive: false, reason: 'cleanup'},
      await stepUp(h, admin),
      KEY('pii-3'),
    );
    h.clock.advance(17 * 60_000);
    for (let i = 0; i < 20; i++) await h.services.saga.tick();
    expect(await h.rpc.workspaceStatus(tid)).toBeNull();
    // A replay after the deletion does not resurrect the DTO.
    expect(
      await code(
        h.rpc.adminPatchUser(
          admin,
          uid,
          {trialExpiresAt: at, reason: 'extend'},
          await stepUp(h, admin),
          KEY('pii-1'),
        ),
      ),
    ).toBe('NOT_FOUND');

    const raw = (h.db as unknown as SqliteD1).raw;
    const tables = raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as {name: string}[];
    for (const {name} of tables) {
      const dump = JSON.stringify(raw.prepare(`SELECT * FROM "${name}"`).all());
      expect(dump, name).not.toContain('pii-owner');
      expect(dump, name).not.toContain(uid);
    }
    const audit = await h.db
      .prepare(
        'SELECT action, target_tenant_id AS t, target_user_id AS u FROM admin_audit',
      )
      .all<{action: string; t: string | null; u: string | null}>();
    expect(audit.results.every(r => r.u === null)).toBe(true);
    expect(audit.results.filter(r => r.t === tid).map(r => r.action)).toEqual(
      expect.arrayContaining([
        'email.view',
        'user.patch',
        'sessions.revoke',
        'user.delete',
      ]),
    );
  });

  it('records sign-in, step-up and passkey changes', async () => {
    const h = await createHarness(createTestD1('identity-access'));
    const {ctx, recoveryCodes} = await fullAdmin(h);
    await addPasskey(h, ctx, 'pk3', await stepUp(h, ctx));
    await h.rpc.adminDeletePasskey(ctx, 'pk3', await stepUp(h, ctx));
    const pre = await adminPreAuth(h);
    await h.rpc.recoveryLogin(pre.preAuth, recoveryCodes[0], {ip: '1'});
    const rows = await h.db
      .prepare(
        'SELECT action, reason, target_tenant_id AS t, target_user_id AS u, result FROM admin_audit ORDER BY at',
      )
      .all<{
        action: string;
        reason: string | null;
        t: string;
        u: null;
        result: null;
      }>();
    expect(rows.results.map(r => `${r.action}/${r.reason ?? ''}`)).toEqual([
      'passkey.add/setup',
      'admin.login/passkey',
      'admin.step_up/',
      'passkey.add/',
      'admin.step_up/',
      'passkey.add/',
      'admin.step_up/',
      'passkey.delete/',
      'admin.login/recovery',
    ]);
    for (const r of rows.results) {
      expect(r.t).toBe(ctx.tid);
      expect(r.u).toBeNull();
    }
    expect(JSON.stringify(rows.results)).not.toContain(ADMIN_EMAIL);
    expect((await h.rpc.adminAuditLog(ctx, {})).chainOk).toBe(true);
  });
});

describe('admin users list stats (AdminUserRow.objects / links)', () => {
  it('reads tenantStats once per page and falls back to 0/0', async () => {
    const h = await createHarness(createTestD1('identity-access'));
    const {ctx} = await fullAdmin(h);
    const a = await signup(h, 'a@example.com', '192.0.2.10');
    const b = await signup(h, 'b@example.com', '192.0.2.11');
    const plain = await h.rpc.adminListUsers(ctx, {}, {});
    expect(plain.items.map(r => [r.objects, r.links])).toEqual([
      [0, 0],
      [0, 0],
    ]);
    const calls: string[][] = [];
    const lc = h.lifecycles.objects as unknown as {
      tenantStats: (t: string[]) => Promise<unknown>;
    };
    lc.tenantStats = async tids => {
      calls.push(tids);
      return {[a.me.workspace.tenantId]: {objects: 80, links: 160}};
    };
    const list = await h.rpc.adminListUsers(ctx, {}, {});
    expect(calls).toHaveLength(1);
    expect(calls[0].sort()).toEqual(
      [a.me.workspace.tenantId, b.me.workspace.tenantId].sort(),
    );
    const byTid = Object.fromEntries(list.items.map(r => [r.tenantId, r]));
    expect(byTid[a.me.workspace.tenantId]).toMatchObject({
      objects: 80,
      links: 160,
    });
    expect(byTid[b.me.workspace.tenantId]).toMatchObject({
      objects: 0,
      links: 0,
    });
    expect(await h.rpc.adminGetUser(ctx, a.me.userId)).toMatchObject({
      objects: 80,
      links: 160,
    });
    lc.tenantStats = async () => {
      throw new Error('down');
    };
    expect(
      (await h.rpc.adminListUsers(ctx, {}, {})).items.every(
        r => r.objects === 0,
      ),
    ).toBe(true);
  });
});

describe('overview health flags (D4 / D5)', () => {
  it('without analytics: analyticsConfigured false and analyticsAt null', async () => {
    const h = await createHarness(createTestD1('identity-access'));
    const {ctx} = await fullAdmin(h);
    expect(await h.services.maintenance.analyticsCheck()).toBe(false);
    const ov = await h.rpc.adminOverview(ctx);
    expect(ov).toMatchObject({
      analyticsConfigured: false,
      analyticsAt: null,
      stuckArchives: 0,
      signKeyRotationDue: false,
    });
  });

  it('a failed analytics read keeps the last snapshot and logs analytics.failed', async () => {
    let fail = false;
    const analytics = {
      dailyUsage: async () => {
        if (fail) throw new Error('analytics errors: 1');
        return {workers: 1234, d1Writes: 5, neurons: 6, queues: 7};
      },
    };
    const h = await createHarness(
      createTestD1('identity-access'),
      {},
      undefined,
      {analytics},
    );
    const {ctx} = await fullAdmin(h);
    await h.services.maintenance.analyticsCheck();
    const before = await h.rpc.adminOverview(ctx);
    expect(before.analyticsConfigured).toBe(true);
    expect(before.analyticsAt).not.toBeNull();
    fail = true;
    h.clock.advance(HOUR_MS);
    await h.services.maintenance.analyticsCheck();
    const after = await h.rpc.adminOverview(ctx);
    expect(after.freeQuota.find(q => q.key === 'workers')!.used).toBe(1234);
    expect(after.analyticsAt).toBe(before.analyticsAt);
    expect(
      h.logger.lines.some(
        l => l.level === 'error' && l.msg === 'analytics.failed',
      ),
    ).toBe(true);
  });

  it('flags a B2 signing key older than 30 days (checked every 12 ticks)', async () => {
    const h = await createHarness(createTestD1('identity-access'), {
      b2SignKeyId: '005abcdefkey',
    });
    const {ctx} = await fullAdmin(h);
    // Move to a check tick (every 12th 2-minute slot).
    const slot = 24 * 60_000;
    const t = h.clock.now().getTime();
    h.clock.advance(slot - (t % slot));
    const r = await runCron(h.services, h.clock.now());
    expect(r.signKeyChecked).toBe(true);
    h.clock.advance(2 * 60_000);
    expect((await runCron(h.services, h.clock.now())).signKeyChecked).toBe(
      false,
    );
    const flags = await h.db
      .prepare("SELECT key FROM system_flag WHERE key LIKE 'b2_sign_key:%'")
      .all<{key: string}>();
    expect(flags.results).toHaveLength(1);
    expect(flags.results[0].key).not.toContain('005abcdefkey');
    expect((await h.rpc.adminOverview(ctx)).signKeyRotationDue).toBe(false);
    h.clock.advance(31 * 24 * HOUR_MS);
    expect(await h.services.maintenance.signKeyCheck()).toBe(true);
    const due = h.logger.lines.find(l => l.msg === 'b2.sign_key_rotation_due');
    expect(due).toBeDefined();
    expect(JSON.stringify(due)).not.toContain('005abcdefkey');
    // The admin logs in again after the 8 h session ended.
    const pre = await adminPreAuth(h);
    const o = await h.rpc.passkeyOptions({preAuth: pre.preAuth}, 'login');
    const s = await h.rpc.passkeyAssertion(
      {preAuth: pre.preAuth},
      'login',
      FakeWebAuthn.credential('pk1', challengeOfOptions(o), {counter: 999}),
      {ip: '1'},
    );
    const fresh = ctxOf(s as IssuedSession);
    expect((await h.rpc.adminOverview(fresh)).signKeyRotationDue).toBe(true);
    expect(ctx.tid).toBe(fresh.tid);
  });
});

describe('controlled admin e-mail change from the ops script (B1)', () => {
  it('applies an {emailEnc} payload sealed by scripts/admin_pending_change.mjs', async () => {
    const h = await createHarness(createTestD1('identity-access'));
    await fullAdmin(h);
    const path = '../../../scripts/admin_pending_change.mjs';
    const script = (await import(/* @vite-ignore */ path)) as {
      parseArgs(a: string[]): unknown;
      buildRow(
        a: unknown,
        o: {now: number; encKey: string},
      ): Promise<Record<string, unknown>>;
      insertSql(r: Record<string, unknown>): string;
    };
    const row = await script.buildRow(
      script.parseArgs([
        '--kind',
        'email',
        '--email',
        'Next-Root@Ontodecide.test',
      ]),
      {now: h.clock.now().getTime(), encKey: h.config.emailEncKey},
    );
    await h.db.prepare(script.insertSql(row)).run();
    await h.services.maintenance.pendingChanges();
    expect(
      allMail(h)
        .filter(m => m.template === 'admin_pending_change')
        .map(m => m.to),
    ).toEqual([ADMIN_EMAIL]);
    h.clock.advance(24 * HOUR_MS + 60_000);
    await h.services.maintenance.pendingChanges();
    const a = await h.services.accounts.accounts.findAdmin();
    expect(a!.emailHmac).toBe(
      await h.services.accounts['secrets'].emailHmac(
        'next-root@ontodecide.test',
      ),
    );
    expect(
      await h.db.prepare('SELECT COUNT(*) AS n FROM session').first(),
    ).toEqual({n: 0});
  });
});
