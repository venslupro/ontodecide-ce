/**
 * @fileoverview Tests for the PBKDF2 hasher, the JWT signer and the D1
 * repositories (tenant scoping, rotation, bootstrap atomicity).
 */

import {
  FixedClock,
  base64urlDecode,
  fromUtf8,
  parseJwtKeys,
  verifyJwt,
} from '@ontodecide/shared-kernel';
import {createTestD1} from '@ontodecide/testing';
import {describe, expect, it} from 'vitest';
import type {JwtClaims} from '../contract';
import {User, newRefreshRecord} from '../domain';
import {D1AuditLog} from './d1_audit_log';
import {D1TokenRepository} from './d1_token_repository';
import {D1UserRepository} from './d1_user_repository';
import {JwtTokenSigner} from './jwt_token_signer';
import {Pbkdf2PasswordHasher} from './pbkdf2_password_hasher';

const NOW = Date.parse('2026-09-24T00:00:00Z');

function user(
  id: string,
  tenantId: string,
  email: string,
  role = 'Admin' as const,
) {
  return User.create({
    id,
    tenantId,
    email,
    name: id,
    role,
    markings: ['pii'],
    pwdHash: '1$x',
    pwdSalt: 'AAAA',
    mustChangePassword: false,
    now: NOW,
  });
}

describe('Pbkdf2PasswordHasher', () => {
  it('stores <iterations>$<hash> with a 16-byte salt and verifies', async () => {
    const hasher = new Pbkdf2PasswordHasher(1000);
    const h = await hasher.hash('Secret-Pass1');
    expect(h.hash).toMatch(/^1000\$[A-Za-z0-9_-]{43}$/);
    expect(base64urlDecode(h.salt)).toHaveLength(16);
    expect(await hasher.verify('Secret-Pass1', h)).toBe(true);
    expect(await hasher.verify('Secret-Pass2', h)).toBe(false);
    // Hashes made with other iteration counts still verify.
    expect(await new Pbkdf2PasswordHasher(2000).verify('Secret-Pass1', h)).toBe(
      true,
    );
    expect(
      await hasher.verify('Secret-Pass1', {hash: 'garbage', salt: h.salt}),
    ).toBe(false);
    const again = await hasher.hash('Secret-Pass1');
    expect(again.salt).not.toBe(h.salt);
  });

  it('defaults to 100,000 iterations', async () => {
    const h = await new Pbkdf2PasswordHasher().hash('x');
    expect(h.hash.startsWith('100000$')).toBe(true);
  });
});

describe('JwtTokenSigner', () => {
  it('signs HS256 with kid and the contract claims', async () => {
    const keys = parseJwtKeys('kA:secret-a,kB:secret-b');
    const u = user('u1', 't1', 'a@x.io');
    const token = await new JwtTokenSigner(keys).signAccessToken(
      u,
      new Date(NOW),
    );
    const header = JSON.parse(fromUtf8(base64urlDecode(token.split('.')[0])));
    expect(header).toEqual({alg: 'HS256', typ: 'JWT', kid: 'kA'});
    const claims = await verifyJwt<JwtClaims>(token, keys, NOW / 1000);
    expect(claims).toMatchObject({
      sub: 'u1',
      tid: 't1',
      role: 'Admin',
      mk: ['pii'],
      name: 'u1',
      locale: 'zh-CN',
      iat: NOW / 1000,
      exp: NOW / 1000 + 900,
    });
    expect(claims.jti).toHaveLength(26);
    await expect(
      verifyJwt(token, keys, NOW / 1000 + 900),
    ).rejects.toMatchObject({
      code: 'AUTH_EXPIRED',
    });
  });
});

describe('D1 repositories', () => {
  it('scopes user queries by tenant', async () => {
    const repo = new D1UserRepository(createTestD1('identity'));
    await repo.insert(user('a', 't1', 'a@x.io'));
    await repo.insert(user('b', 't2', 'b@x.io'));
    expect(await repo.findById('t1', 'b')).toBeNull();
    expect((await repo.findById('t2', 'b'))?.email).toBe('b@x.io');
    expect((await repo.listByTenant('t1')).map(u => u.id)).toEqual(['a']);
    expect(await repo.countActiveAdmins('t1')).toBe(1);
    await repo.delete('t1', 'b');
    expect(await repo.countAll()).toBe(2);
    await expect(repo.insert(user('c', 't1', 'a@x.io'))).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('round-trips user state through save', async () => {
    const repo = new D1UserRepository(createTestD1('identity'));
    const u = user('a', 't1', 'a@x.io');
    await repo.insert(u);
    u.recordLoginFailure(NOW + 1);
    u.setMarkings(['z', 'y'], NOW + 2);
    u.disable(NOW + 3);
    await repo.save(u);
    const back = await repo.findById('t1', 'a');
    expect(back?.state).toEqual(u.state);
  });

  it('bootstraps only into an empty database', async () => {
    const db = createTestD1('identity');
    const repo = new D1UserRepository(db);
    const tenant = {id: 't1', name: 'Acme', createdAt: NOW};
    expect(await repo.bootstrap(tenant, user('a', 't1', 'a@x.io'))).toBe(true);
    expect(
      await repo.bootstrap({...tenant, id: 't2'}, user('b', 't2', 'b@x.io')),
    ).toBe(false);
    const n = await db
      .prepare('SELECT COUNT(*) AS n FROM idn_tenant')
      .first('n');
    expect(n).toBe(1);
  });

  it('rotates a token only once and revokes by family and user', async () => {
    const repo = new D1TokenRepository(createTestD1('identity'));
    const mk = (h: string, family: string, userId = 'u1') =>
      newRefreshRecord({
        tokenHash: h,
        userId,
        tenantId: 't1',
        family,
        now: NOW,
      });
    await repo.insert(mk('h1', 'f1'));
    await repo.insert(mk('h2', 'f1'));
    await repo.insert(mk('h3', 'f2'));
    await repo.insert(mk('h4', 'f3', 'u2'));
    expect(await repo.markRotated('h1')).toBe(true);
    expect(await repo.markRotated('h1')).toBe(false);
    expect((await repo.findByHash('h1'))?.rotated).toBe(true);
    await repo.revokeFamily('f1');
    expect((await repo.findByHash('h2'))?.revoked).toBe(true);
    expect((await repo.findByHash('h3'))?.revoked).toBe(false);
    await repo.revokeAllForUser('t1', 'u1');
    expect((await repo.findByHash('h3'))?.revoked).toBe(true);
    expect((await repo.findByHash('h4'))?.revoked).toBe(false);
    await repo.deleteAllForUser('t1', 'u2');
    expect(await repo.findByHash('h4')).toBeNull();
  });

  it('writes audit entries', async () => {
    const db = createTestD1('identity');
    await new D1AuditLog(db, new FixedClock(NOW)).record({
      tenantId: 't1',
      actor: 'a',
      event: 'user.role_changed',
      subject: 'b',
      detail: {from: 'Viewer', to: 'Admin'},
    });
    const row = await db
      .prepare('SELECT * FROM idn_audit')
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({
      tenant_id: 't1',
      actor: 'a',
      event: 'user.role_changed',
      subject: 'b',
      created_at: NOW,
    });
    expect(JSON.parse(row!.detail as string)).toEqual({
      from: 'Viewer',
      to: 'Admin',
    });
  });
});
