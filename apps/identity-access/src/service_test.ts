/**
 * @fileoverview Integration tests of identity-access through createService
 * against the D1 emulation (bootstrap, login, lockout, refresh rotation,
 * user administration, guards, tenant isolation, RPC error transport).
 */

import type {
  IdentityRpc,
  JwtClaims,
  TokenPair,
} from '@ontodecide/identity/contract';
import {
  Pbkdf2PasswordHasher,
  D1UserRepository,
} from '@ontodecide/identity/infrastructure';
import {User} from '@ontodecide/identity/domain';
import {
  AppError,
  FixedClock,
  MINUTE_MS,
  DAY_MS,
  base64urlDecode,
  fromUtf8,
  parseJwtKeys,
  sha256Hex,
  silentLogger,
  type CallCtx,
  type ErrorCode,
  verifyJwt,
} from '@ontodecide/shared-kernel';
import {beforeEach, describe, expect, it} from 'vitest';
// apps do not depend on @ontodecide/testing, so import it by path.
import {createTestD1, rpcBinding, testCtx} from '@ontodecide/testing';
import type {Env} from './env';
import {createService} from './service';

const JWT_SECRET = 'k7:primary-secret,k6:previous-secret';
const ADMIN_EMAIL = 'Admin@Example.com';
const ADMIN_PASSWORD = 'Bootstrap-Pass1';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    IDENTITY_DB: createTestD1('identity'),
    JWT_SECRET,
    BOOTSTRAP_ADMIN_EMAIL: ADMIN_EMAIL,
    BOOTSTRAP_ADMIN_PASSWORD: ADMIN_PASSWORD,
    BOOTSTRAP_TENANT_NAME: 'Acme',
    ENVIRONMENT: 'test',
    ...overrides,
  };
}

async function expectCode(
  p: Promise<unknown>,
  code: ErrorCode,
): Promise<AppError> {
  const err = AppError.from(
    await p.then(
      () => {
        throw new Error(`expected ${code}, got success`);
      },
      (e: unknown) => e,
    ),
  );
  expect(err.code).toBe(code);
  return err;
}

function ctxOf(pair: TokenPair): CallCtx {
  return testCtx({
    tenantId: pair.user.tenantId,
    userId: pair.user.id,
    role: pair.user.role,
    markings: pair.user.markings,
  });
}

describe('identity-access service', () => {
  let env: Env;
  let clock: FixedClock;
  let rpc: IdentityRpc;
  const nowSec = () => Math.floor(clock.now().getTime() / 1000);

  const audit = async (event: string) =>
    (
      await env.IDENTITY_DB.prepare(
        'SELECT tenant_id, actor, event, subject, detail FROM idn_audit WHERE event = ?',
      )
        .bind(event)
        .all<{
          tenant_id: string;
          actor: string;
          subject: string;
          detail: string | null;
        }>()
    ).results;

  const bootstrap = () =>
    rpc.login({email: 'admin@example.COM', password: ADMIN_PASSWORD});

  async function adminWithUser(password = 'User-Pass-123') {
    const admin = await bootstrap();
    const {user} = await rpc.createUser(ctxOf(admin), {
      email: 'Bob@Example.com',
      name: 'Bob',
      role: 'Operator',
      password,
    });
    return {admin, user, password};
  }

  beforeEach(() => {
    env = makeEnv();
    clock = new FixedClock('2026-09-24T00:00:00Z');
    rpc = createService(env, {
      clock,
      logger: silentLogger,
      pbkdf2Iterations: 1000,
    }).rpc;
  });

  describe('bootstrap and login', () => {
    it('creates the tenant and admin on first login against an empty db', async () => {
      const pair = await bootstrap();
      expect(pair.user).toMatchObject({
        email: 'admin@example.com',
        role: 'Admin',
        mustChangePassword: false,
        disabled: false,
        markings: [],
      });
      expect(pair.expiresIn).toBe(900);
      expect(pair.user.lastLoginAt).toBe('2026-09-24T00:00:00.000Z');
      const tenant = await env.IDENTITY_DB.prepare(
        'SELECT id, name FROM idn_tenant',
      ).all<{
        id: string;
        name: string;
      }>();
      expect(tenant.results).toEqual([{id: pair.user.tenantId, name: 'Acme'}]);
      expect(await audit('auth.bootstrap')).toHaveLength(1);

      // Subsequent logins use the stored user; no second tenant.
      const again = await bootstrap();
      expect(again.user.id).toBe(pair.user.id);
      const n = await env.IDENTITY_DB.prepare(
        'SELECT COUNT(*) AS n FROM idn_tenant',
      ).first('n');
      expect(n).toBe(1);
    });

    it('refuses bootstrap with the wrong password or another email', async () => {
      await expectCode(
        rpc.login({email: ADMIN_EMAIL, password: 'nope'}),
        'AUTH_INVALID',
      );
      await expectCode(
        rpc.login({email: 'other@example.com', password: ADMIN_PASSWORD}),
        'AUTH_INVALID',
      );
      const n = await env.IDENTITY_DB.prepare(
        'SELECT COUNT(*) AS n FROM idn_user',
      ).first('n');
      expect(n).toBe(0);
    });

    it('does not bootstrap when not configured', async () => {
      env = makeEnv({BOOTSTRAP_ADMIN_PASSWORD: undefined});
      rpc = createService(env, {
        clock,
        logger: silentLogger,
        pbkdf2Iterations: 1000,
      }).rpc;
      await expectCode(bootstrap(), 'AUTH_INVALID');
    });

    it('issues an access JWT with kid and the expected claims', async () => {
      const pair = await bootstrap();
      const header = JSON.parse(
        fromUtf8(base64urlDecode(pair.accessToken.split('.')[0])),
      );
      expect(header.kid).toBe('k7');
      const claims = await verifyWith(JWT_SECRET, pair.accessToken, nowSec());
      expect(claims).toMatchObject({
        sub: pair.user.id,
        tid: pair.user.tenantId,
        role: 'Admin',
        mk: [],
        name: 'Administrator',
        locale: 'zh-CN',
        iat: nowSec(),
        exp: nowSec() + 900,
      });
      expect(claims.jti).toBeTruthy();
      // A gateway that already rotated to a new primary key still verifies by kid.
      await verifyWith(
        'k8:next-secret,k7:primary-secret',
        pair.accessToken,
        nowSec(),
      );
      await expectCode(
        verifyWith('k7:wrong', pair.accessToken, nowSec()),
        'AUTH_INVALID',
      );
    });

    it('validates login input', async () => {
      await expectCode(
        rpc.login({email: 'not-an-email', password: 'x'}),
        'VALIDATION_FAILED',
      );
    });
  });

  describe('lock policy', () => {
    it('uses one message for unknown email and wrong password', async () => {
      await adminWithUser();
      const a = await expectCode(
        rpc.login({email: 'nobody@example.com', password: 'User-Pass-123'}),
        'AUTH_INVALID',
      );
      const b = await expectCode(
        rpc.login({email: 'bob@example.com', password: 'Wrong-Pass-1'}),
        'AUTH_INVALID',
      );
      expect(a.detail).toBe(b.detail);
    });

    it('locks after 5 consecutive failures for 15 minutes', async () => {
      const {password} = await adminWithUser();
      for (let i = 0; i < 5; i++) {
        await expectCode(
          rpc.login({email: 'bob@example.com', password: 'Wrong-Pass-1'}),
          'AUTH_INVALID',
        );
      }
      const locked = await expectCode(
        rpc.login({email: 'bob@example.com', password}),
        'AUTH_LOCKED',
      );
      expect(locked.status).toBe(423);
      clock.advance(15 * MINUTE_MS - 1000);
      await expectCode(
        rpc.login({email: 'bob@example.com', password}),
        'AUTH_LOCKED',
      );
      clock.advance(1000);
      const ok = await rpc.login({email: 'bob@example.com', password});
      expect(ok.user.email).toBe('bob@example.com');

      expect(await audit('auth.locked')).toHaveLength(1);
      const failures = await audit('auth.login_failed');
      expect(failures).toHaveLength(5);
      for (const row of failures) {
        expect(JSON.stringify(row)).not.toContain('Wrong-Pass-1');
      }
    });

    it('resets the failure counter after a successful login', async () => {
      const {password} = await adminWithUser();
      const fail = () =>
        expectCode(
          rpc.login({email: 'bob@example.com', password: 'Wrong-Pass-1'}),
          'AUTH_INVALID',
        );
      for (let i = 0; i < 4; i++) await fail();
      await rpc.login({email: 'bob@example.com', password});
      for (let i = 0; i < 4; i++) await fail();
      await rpc.login({email: 'bob@example.com', password});
    });

    it('rejects disabled users with AUTH_INVALID', async () => {
      const {admin, user, password} = await adminWithUser();
      await rpc.updateUser(ctxOf(admin), user.id, {disabled: true});
      const err = await expectCode(
        rpc.login({email: 'bob@example.com', password}),
        'AUTH_INVALID',
      );
      expect(err.detail).toBe('Invalid email or password');
    });
  });

  describe('refresh tokens', () => {
    it('rotates, and replay of a rotated token revokes the family', async () => {
      const first = await bootstrap();
      const other = await bootstrap(); // separate family
      clock.advance(60_000);
      const second = await rpc.refresh(first.refreshToken);
      expect(second.refreshToken).not.toBe(first.refreshToken);
      expect(second.accessToken).not.toBe(first.accessToken);
      expect(second.user.id).toBe(first.user.id);
      await verifyWith(JWT_SECRET, second.accessToken, nowSec());

      await expectCode(rpc.refresh(first.refreshToken), 'AUTH_INVALID');
      await expectCode(rpc.refresh(second.refreshToken), 'AUTH_INVALID');
      // Both presentations hit a rotated/revoked token.
      expect(await audit('auth.refresh_replay')).toHaveLength(2);
      // Other families are untouched.
      await rpc.refresh(other.refreshToken);
    });

    it('stores only the token hash and expires after 7 days', async () => {
      const pair = await bootstrap();
      const rows = await env.IDENTITY_DB.prepare(
        'SELECT token_hash FROM idn_refresh_token',
      ).all<{token_hash: string}>();
      expect(rows.results.map(r => r.token_hash)).toEqual([
        await sha256Hex(pair.refreshToken),
      ]);
      expect(Date.parse(pair.refreshExpiresAt) - clock.now().getTime()).toBe(
        7 * DAY_MS,
      );
      clock.advance(7 * DAY_MS);
      await expectCode(rpc.refresh(pair.refreshToken), 'AUTH_INVALID');
    });

    it('rejects unknown tokens and tokens of disabled users', async () => {
      await expectCode(rpc.refresh('garbage'), 'AUTH_INVALID');
      await expectCode(rpc.refresh(''), 'AUTH_INVALID');
      const {admin, user, password} = await adminWithUser();
      const bob = await rpc.login({email: 'bob@example.com', password});
      await rpc.updateUser(ctxOf(admin), user.id, {disabled: true});
      await expectCode(rpc.refresh(bob.refreshToken), 'AUTH_INVALID');
    });

    it('logout revokes the family and is idempotent', async () => {
      const pair = await bootstrap();
      const next = await rpc.refresh(pair.refreshToken);
      await rpc.logout(pair.refreshToken);
      await expectCode(rpc.refresh(next.refreshToken), 'AUTH_INVALID');
      await rpc.logout(next.refreshToken);
      await rpc.logout('unknown');
      await rpc.logout('');
    });
  });

  describe('me', () => {
    it('reads and updates the caller profile', async () => {
      const admin = await bootstrap();
      expect((await rpc.me(ctxOf(admin))).email).toBe('admin@example.com');
      const updated = await rpc.updateMe(ctxOf(admin), {
        name: 'Root',
        locale: 'en-US',
      });
      expect(updated).toMatchObject({name: 'Root', locale: 'en-US'});
      await expectCode(
        rpc.updateMe(ctxOf(admin), {locale: 'fr-FR'}),
        'VALIDATION_FAILED',
      );
      // Claims pick up the new profile on the next token.
      const next = await rpc.refresh(admin.refreshToken);
      const claims = await verifyWith(JWT_SECRET, next.accessToken, nowSec());
      expect(claims).toMatchObject({name: 'Root', locale: 'en-US'});
    });
  });

  describe('user administration', () => {
    it('creates users with a temporary password that must be changed', async () => {
      const admin = await bootstrap();
      const res = await rpc.createUser(ctxOf(admin), {
        email: 'Carol@Example.com',
        name: 'Carol',
        role: 'Viewer',
        markings: ['pii', 'pii', 'finance'],
      });
      expect(res.temporaryPassword).toMatch(/^.{16}$/);
      expect(res.user).toMatchObject({
        email: 'carol@example.com',
        role: 'Viewer',
        markings: ['finance', 'pii'],
        mustChangePassword: true,
        tenantId: admin.user.tenantId,
      });
      const carol = await rpc.login({
        email: 'carol@example.com',
        password: res.temporaryPassword!,
      });
      expect(carol.user.mustChangePassword).toBe(true);

      await rpc.changePassword(ctxOf(carol), {
        currentPassword: res.temporaryPassword!,
        newPassword: 'Carol-New-Pass1',
      });
      expect((await rpc.me(ctxOf(carol))).mustChangePassword).toBe(false);
      await expectCode(rpc.refresh(carol.refreshToken), 'AUTH_INVALID');
      await expectCode(
        rpc.login({
          email: 'carol@example.com',
          password: res.temporaryPassword!,
        }),
        'AUTH_INVALID',
      );
      await rpc.login({
        email: 'carol@example.com',
        password: 'Carol-New-Pass1',
      });
      expect(await audit('user.created')).toHaveLength(1);
    });

    it('creates users with a given password and rejects duplicates', async () => {
      const {admin} = await adminWithUser();
      const listed = await rpc.listUsers(ctxOf(admin));
      expect(listed.map(u => u.email).sort()).toEqual([
        'admin@example.com',
        'bob@example.com',
      ]);
      expect(
        listed.find(u => u.email === 'bob@example.com')?.mustChangePassword,
      ).toBe(false);
      await expectCode(
        rpc.createUser(ctxOf(admin), {
          email: 'BOB@example.com',
          name: 'B2',
          role: 'Viewer',
        }),
        'CONFLICT',
      );
      await expectCode(
        rpc.createUser(ctxOf(admin), {
          email: 'x@example.com',
          name: 'X',
          role: 'Viewer',
          password: 'weak',
        }),
        'VALIDATION_FAILED',
      );
      await expectCode(
        rpc.createUser(ctxOf(admin), {
          email: 'x@example.com',
          name: 'X',
          role: 'Root' as never,
        }),
        'VALIDATION_FAILED',
      );
    });

    it('requires the Admin role for administration', async () => {
      const {admin, user, password} = await adminWithUser();
      const bob = ctxOf(await rpc.login({email: 'bob@example.com', password}));
      await expectCode(rpc.listUsers(bob), 'FORBIDDEN');
      await expectCode(
        rpc.createUser(bob, {email: 'y@example.com', name: 'Y', role: 'Admin'}),
        'FORBIDDEN',
      );
      await expectCode(
        rpc.updateUser(bob, user.id, {role: 'Admin'}),
        'FORBIDDEN',
      );
      await expectCode(rpc.grantMarking(bob, user.id, ['x']), 'FORBIDDEN');
      await expectCode(rpc.resetPassword(bob, admin.user.id), 'FORBIDDEN');
      await expectCode(rpc.deleteUser(bob, admin.user.id), 'FORBIDDEN');
    });

    it('updates name, role and disabled flag with audit', async () => {
      const {admin, user, password} = await adminWithUser();
      const bobSession = await rpc.login({email: 'bob@example.com', password});
      const updated = await rpc.updateUser(ctxOf(admin), user.id, {
        name: 'Robert',
        role: 'Modeler',
      });
      expect(updated).toMatchObject({name: 'Robert', role: 'Modeler'});
      const roleAudit = await audit('user.role_changed');
      expect(roleAudit).toHaveLength(1);
      expect(roleAudit[0]).toMatchObject({
        actor: admin.user.id,
        subject: user.id,
      });
      expect(JSON.parse(roleAudit[0].detail!)).toEqual({
        from: 'Operator',
        to: 'Modeler',
      });

      // Refresh reflects the new role in the claims.
      const next = await rpc.refresh(bobSession.refreshToken);
      expect(
        (await verifyWith(JWT_SECRET, next.accessToken, nowSec())).role,
      ).toBe('Modeler');

      const disabled = await rpc.updateUser(ctxOf(admin), user.id, {
        disabled: true,
      });
      expect(disabled.disabled).toBe(true);
      await expectCode(rpc.refresh(next.refreshToken), 'AUTH_INVALID');
      await rpc.updateUser(ctxOf(admin), user.id, {disabled: false});
      await rpc.login({email: 'bob@example.com', password});
      expect(await audit('user.disabled')).toHaveLength(1);
      expect(await audit('user.enabled')).toHaveLength(1);
      await expectCode(
        rpc.updateUser(ctxOf(admin), 'missing', {name: 'x'}),
        'NOT_FOUND',
      );
    });

    it('deletes users and their sessions', async () => {
      const {admin, user, password} = await adminWithUser();
      const bob = await rpc.login({email: 'bob@example.com', password});
      await rpc.deleteUser(ctxOf(admin), user.id);
      expect((await rpc.listUsers(ctxOf(admin))).map(u => u.id)).toEqual([
        admin.user.id,
      ]);
      await expectCode(rpc.refresh(bob.refreshToken), 'AUTH_INVALID');
      await expectCode(
        rpc.login({email: 'bob@example.com', password}),
        'AUTH_INVALID',
      );
      await expectCode(rpc.deleteUser(ctxOf(admin), user.id), 'NOT_FOUND');
      expect(await audit('user.deleted')).toHaveLength(1);
    });

    it('prevents admins from removing themselves', async () => {
      const admin = await bootstrap();
      const c = ctxOf(admin);
      await expectCode(rpc.deleteUser(c, admin.user.id), 'FORBIDDEN');
      await expectCode(
        rpc.updateUser(c, admin.user.id, {role: 'Viewer'}),
        'FORBIDDEN',
      );
      await expectCode(
        rpc.updateUser(c, admin.user.id, {disabled: true}),
        'FORBIDDEN',
      );
      // Harmless self updates are fine.
      await rpc.updateUser(c, admin.user.id, {
        name: 'Boss',
        role: 'Admin',
        disabled: false,
      });
    });

    it('keeps at least one active Admin per tenant', async () => {
      const admin = await bootstrap();
      const {user: second, temporaryPassword} = await rpc.createUser(
        ctxOf(admin),
        {
          email: 'second@example.com',
          name: 'Second',
          role: 'Admin',
        },
      );
      const secondSession = await rpc.login({
        email: 'second@example.com',
        password: temporaryPassword!,
      });
      // Two admins: demoting one is allowed.
      await rpc.updateUser(ctxOf(admin), second.id, {role: 'Viewer'});
      // A stale Admin ctx of the demoted user cannot remove the last Admin.
      const stale = ctxOf(secondSession);
      await expectCode(
        rpc.updateUser(stale, admin.user.id, {role: 'Operator'}),
        'CONFLICT',
      );
      await expectCode(
        rpc.updateUser(stale, admin.user.id, {disabled: true}),
        'CONFLICT',
      );
      await expectCode(rpc.deleteUser(stale, admin.user.id), 'CONFLICT');
      expect((await rpc.me(ctxOf(admin))).role).toBe('Admin');
    });

    it('grants markings (replacing the set) and audits the change', async () => {
      const {admin, user, password} = await adminWithUser();
      const res = await rpc.grantMarking(ctxOf(admin), user.id, [
        'pii',
        'finance',
        'pii',
      ]);
      expect(res.markings).toEqual(['finance', 'pii']);
      const bob = await rpc.login({email: 'bob@example.com', password});
      expect(
        (await verifyWith(JWT_SECRET, bob.accessToken, nowSec())).mk,
      ).toEqual(['finance', 'pii']);
      expect(
        (await rpc.grantMarking(ctxOf(admin), user.id, ['pii'])).markings,
      ).toEqual(['pii']);
      const rows = await audit('user.markings_changed');
      expect(rows).toHaveLength(2);
      expect(JSON.parse(rows[1].detail!)).toEqual({
        from: ['finance', 'pii'],
        to: ['pii'],
      });
      await expectCode(
        rpc.grantMarking(ctxOf(admin), user.id, ['']),
        'VALIDATION_FAILED',
      );
      await expectCode(
        rpc.grantMarking(ctxOf(admin), 'missing', ['x']),
        'NOT_FOUND',
      );
    });

    it('resets a password: temp password, forced change, unlock, sessions revoked', async () => {
      const {admin, user, password} = await adminWithUser();
      const bob = await rpc.login({email: 'bob@example.com', password});
      for (let i = 0; i < 5; i++) {
        await expectCode(
          rpc.login({email: 'bob@example.com', password: 'Wrong-Pass-1'}),
          'AUTH_INVALID',
        );
      }
      const {temporaryPassword} = await rpc.resetPassword(
        ctxOf(admin),
        user.id,
      );
      await expectCode(rpc.refresh(bob.refreshToken), 'AUTH_INVALID');
      await expectCode(
        rpc.login({email: 'bob@example.com', password}),
        'AUTH_INVALID',
      );
      const again = await rpc.login({
        email: 'bob@example.com',
        password: temporaryPassword,
      });
      expect(again.user.mustChangePassword).toBe(true);
      const rows = await audit('user.password_reset');
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows)).not.toContain(temporaryPassword);
    });

    it('changePassword validates the current and new password', async () => {
      const {password} = await adminWithUser();
      const bob = ctxOf(await rpc.login({email: 'bob@example.com', password}));
      await expectCode(
        rpc.changePassword(bob, {
          currentPassword: 'Wrong-Pass-1',
          newPassword: 'Next-Pass-123',
        }),
        'VALIDATION_FAILED',
      );
      await expectCode(
        rpc.changePassword(bob, {
          currentPassword: password,
          newPassword: 'short',
        }),
        'VALIDATION_FAILED',
      );
      await expectCode(
        rpc.changePassword(bob, {
          currentPassword: password,
          newPassword: password,
        }),
        'VALIDATION_FAILED',
      );
      await rpc.changePassword(bob, {
        currentPassword: password,
        newPassword: 'Next-Pass-123',
      });
      await rpc.login({email: 'bob@example.com', password: 'Next-Pass-123'});
    });
  });

  describe('tenant isolation', () => {
    it('never touches users of another tenant', async () => {
      const {admin, user} = await adminWithUser();
      // Seed a second tenant with its own admin.
      const hasher = new Pbkdf2PasswordHasher(1000);
      const pwd = await hasher.hash('Other-Pass-123');
      await env.IDENTITY_DB.prepare(
        'INSERT INTO idn_tenant (id, name, created_at) VALUES (?, ?, ?)',
      )
        .bind('t2', 'Other', 0)
        .run();
      await new D1UserRepository(env.IDENTITY_DB).insert(
        User.create({
          id: 'u-other',
          tenantId: 't2',
          email: 'other@example.com',
          name: 'Other',
          role: 'Admin',
          pwdHash: pwd.hash,
          pwdSalt: pwd.salt,
          mustChangePassword: false,
          now: 0,
        }),
      );
      const other = await rpc.login({
        email: 'other@example.com',
        password: 'Other-Pass-123',
      });
      expect(other.user.tenantId).toBe('t2');
      const oc = ctxOf(other);

      expect((await rpc.listUsers(oc)).map(u => u.id)).toEqual(['u-other']);
      expect((await rpc.listUsers(ctxOf(admin))).map(u => u.id)).not.toContain(
        'u-other',
      );
      await expectCode(
        rpc.updateUser(oc, user.id, {role: 'Viewer'}),
        'NOT_FOUND',
      );
      await expectCode(rpc.grantMarking(oc, user.id, ['x']), 'NOT_FOUND');
      await expectCode(rpc.resetPassword(oc, user.id), 'NOT_FOUND');
      await expectCode(rpc.deleteUser(oc, admin.user.id), 'NOT_FOUND');
      // A ctx claiming the wrong tenant cannot read the user.
      await expectCode(
        rpc.me({...ctxOf(admin), tenantId: 't2'}),
        'AUTH_INVALID',
      );
      expect((await rpc.me(ctxOf(admin))).role).toBe('Admin');
    });
  });

  describe('RPC transport', () => {
    it('AppErrors survive the service binding', async () => {
      const stub = rpcBinding(
        createService(env, {
          clock,
          logger: silentLogger,
          pbkdf2Iterations: 1000,
        }).rpc,
      );
      const pair = await stub.login({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
      });
      expect(pair.user.role).toBe('Admin');

      const err = await stub
        .login({email: ADMIN_EMAIL, password: 'bad'})
        .catch((e: unknown) => e);
      expect(err).not.toBeInstanceOf(AppError);
      const recovered = AppError.from(err);
      expect(recovered.code).toBe('AUTH_INVALID');
      expect(recovered.status).toBe(401);

      for (let i = 0; i < 4; i++)
        await stub.login({email: ADMIN_EMAIL, password: 'bad'}).catch(() => {});
      const locked = AppError.from(
        await stub
          .login({email: ADMIN_EMAIL, password: ADMIN_PASSWORD})
          .catch((e: unknown) => e),
      );
      expect(locked.code).toBe('AUTH_LOCKED');
      expect(locked.status).toBe(423);
      expect(locked.extras.lockedUntil).toBeTruthy();

      const validation = AppError.from(
        await stub
          .createUser(ctxOf(pair), {email: 'bad', name: '', role: 'Viewer'})
          .catch((e: unknown) => e),
      );
      expect(validation.code).toBe('VALIDATION_FAILED');
      expect(Array.isArray(validation.extras.errors)).toBe(true);
    });

    it('maps unexpected failures to INTERNAL without leaking details', async () => {
      const broken = {
        prepare: () => {
          throw new Error('SQLITE_BUSY: secret internals');
        },
      } as unknown as D1Database;
      const stub = rpcBinding(
        createService(makeEnv({IDENTITY_DB: broken}), {logger: silentLogger})
          .rpc,
      );
      const err = AppError.from(
        await stub
          .login({email: ADMIN_EMAIL, password: 'x'})
          .catch((e: unknown) => e),
      );
      expect(err.code).toBe('INTERNAL');
      expect(err.message).not.toContain('secret internals');
    });
  });
});

async function verifyWith(
  secret: string,
  token: string,
  nowSec: number,
): Promise<JwtClaims> {
  return verifyJwt<JwtClaims>(token, parseJwtKeys(secret), nowSec);
}
