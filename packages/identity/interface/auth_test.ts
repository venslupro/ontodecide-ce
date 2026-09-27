/**
 * @fileoverview Identity use cases against the real migrations: sign-up
 * admission and concurrency, enumeration safety, code limits and locks,
 * sessions, refresh-token families, /me, export and early termination.
 */

import {beforeEach, describe, expect, it} from 'vitest';
import {
  AppError,
  DAY_MS,
  HOUR_MS,
  decodeCursor,
  publicJwkOf,
  verifyJwt,
  type AccessClaims,
  type CallCtx,
} from '@ontodecide/shared-kernel';
import {createTestD1} from '@ontodecide/testing';
import type {IssuedSession} from '../contract';
import {
  allMail,
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

function ownerCtx(s: IssuedSession): CallCtx {
  return {
    tid: s.me.workspace.tenantId,
    sub: s.me.userId,
    actor: {role: 'owner', userId: s.me.userId, actingAs: false},
    requestId: 'r',
    locale: 'zh-CN',
  };
}

async function claims(h: Harness, token: string): Promise<AccessClaims> {
  return verifyJwt<AccessClaims>(
    token,
    [publicJwkOf(h.config.signingKey)],
    Math.floor(h.clock.now().getTime() / 1000),
  );
}

async function count(
  h: Harness,
  sql: string,
  ...args: unknown[]
): Promise<number> {
  const r = await h.db
    .prepare(sql)
    .bind(...args)
    .first<{n: number}>();
  return r?.n ?? 0;
}

describe('sign-up', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness(createTestD1('identity-access'));
  });

  it('creates the workspace and its owner in one batch and issues tokens', async () => {
    const s = await signup(h, 'alice@example.com');
    expect(s.me.role).toBe('owner');
    expect(s.me.email).toBe('alice@example.com');
    expect(s.me.workspace.kind).toBe('trial');
    expect(s.me.workspace.status).toBe('ACTIVE');
    const texp = Date.parse(s.me.workspace.trialExpiresAt!);
    expect(texp - h.clock.now().getTime()).toBe(72 * HOUR_MS);
    expect(s.refreshExpiresAt).toBe(texp);
    expect(s.expiresIn).toBe(900);
    const c = await claims(h, s.accessToken);
    expect(c).toMatchObject({
      sub: s.me.userId,
      role: 'owner',
      tid: s.me.workspace.tenantId,
      st: 'ACTIVE',
      texp: Math.floor(texp / 1000),
      amr: ['otp'],
    });
    expect(c.exp - c.iat).toBe(900);
    // Only hashes are stored.
    const row = await h.db
      .prepare(
        'SELECT email_hmac, email_enc FROM user_account WHERE user_id = ?1',
      )
      .bind(s.me.userId)
      .first<{email_hmac: string; email_enc: string}>();
    expect(row!.email_enc).not.toContain('alice');
    expect(await count(h, 'SELECT COUNT(*) AS n FROM pending_code')).toBe(0);
    const sess = await h.db
      .prepare('SELECT refresh_hash FROM session')
      .first<{refresh_hash: string}>();
    expect(sess!.refresh_hash).not.toBe(s.refreshToken);
    expect(
      await count(
        h,
        "SELECT value AS n FROM usage_counter WHERE key = 'signup'",
      ),
    ).toBe(1);
  });

  it('lets exactly 20 of 21 concurrent sign-ups through', async () => {
    const emails = Array.from({length: 21}, (_, i) => `u${i}@example.com`);
    for (const [i, email] of emails.entries()) {
      await h.rpc.sendCode(
        {email, purpose: 'signup', turnstileToken: 'ok'},
        {ip: `10.0.0.${i}`},
      );
    }
    const results = await Promise.all(
      emails.map((email, i) =>
        code(
          h.rpc.createSession(
            {email, code: lastCode(h, email), purpose: 'signup'},
            {ip: `10.0.0.${i}`},
          ),
        ),
      ),
    );
    expect(results.filter(r => r === 'OK')).toHaveLength(20);
    expect(results.filter(r => r === 'SIGNUP_CLOSED')).toHaveLength(1);
    expect(
      await count(
        h,
        "SELECT COUNT(*) AS n FROM workspace WHERE kind = 'trial'",
      ),
    ).toBe(20);
    // The loser's pending code (with its encrypted e-mail) is gone.
    expect(await count(h, 'SELECT COUNT(*) AS n FROM pending_code')).toBe(0);
    // The pre-check now refuses before storing anything.
    expect(
      await code(
        h.rpc.sendCode(
          {email: 'late@example.com', purpose: 'signup', turnstileToken: 'ok'},
          {ip: '10.1.1.1'},
        ),
      ),
    ).toBe('SIGNUP_CLOSED');
  });

  it('rejects the third sign-up from one IP (pre-check and batch)', async () => {
    const ip = '192.0.2.7';
    for (const e of ['a@example.com', 'b@example.com', 'c@example.com']) {
      await h.rpc.sendCode(
        {email: e, purpose: 'signup', turnstileToken: 'ok'},
        {ip},
      );
    }
    const r = [];
    for (const e of ['a@example.com', 'b@example.com', 'c@example.com']) {
      r.push(
        await code(
          h.rpc.createSession(
            {email: e, code: lastCode(h, e), purpose: 'signup'},
            {ip},
          ),
        ),
      );
    }
    expect(r).toEqual(['OK', 'OK', 'SIGNUP_CLOSED']);
    expect(
      await code(
        h.rpc.sendCode(
          {email: 'd@example.com', purpose: 'signup', turnstileToken: 'ok'},
          {ip},
        ),
      ),
    ).toBe('SIGNUP_CLOSED');
    expect(await count(h, 'SELECT COUNT(*) AS n FROM pending_code')).toBe(0);
  });

  it('refuses when paused, over the active limit or auto-closed', async () => {
    const send = (email: string) =>
      code(
        h.rpc.sendCode(
          {email, purpose: 'signup', turnstileToken: 'ok'},
          {ip: '1.1.1.1'},
        ),
      );
    await h.db
      .prepare(
        "UPDATE platform_setting SET value = 0 WHERE key = 'signup_enabled'",
      )
      .run();
    expect(await send('p@example.com')).toBe('SIGNUP_CLOSED');
    await h.db
      .prepare(
        "UPDATE platform_setting SET value = 1 WHERE key = 'signup_enabled'",
      )
      .run();
    await h.db
      .prepare(
        "INSERT INTO usage_counter (day, key, value) VALUES ('2026-09-24', 'signup_closed', 1)",
      )
      .run();
    expect(await send('q@example.com')).toBe('SIGNUP_CLOSED');
    expect(await count(h, 'SELECT COUNT(*) AS n FROM pending_code')).toBe(0);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM otp_limit')).toBe(0);
  });

  it('answers identically for known and unknown addresses (no enumeration)', async () => {
    await signup(h, 'known@example.com');
    const before = allMail(h).length;
    h.clock.advance(61_000);
    const known = await h.rpc.sendCode(
      {email: 'known@example.com', purpose: 'login', turnstileToken: 'ok'},
      {ip: '1.2.3.4'},
    );
    const unknown = await h.rpc.sendCode(
      {email: 'nobody@example.com', purpose: 'login', turnstileToken: 'ok'},
      {ip: '1.2.3.4'},
    );
    expect(known).toBeUndefined();
    expect(unknown).toBeUndefined();
    expect(allMail(h).length).toBe(before + 1);
    // Sign-up for an existing address also resolves without a code.
    await h.rpc.sendCode(
      {email: 'known@example.com', purpose: 'signup', turnstileToken: 'ok'},
      {ip: '1.2.3.5'},
    );
    expect(allMail(h).length).toBe(before + 1);
    // Unknown address: a guessed code is simply invalid.
    expect(
      await code(
        h.rpc.createSession(
          {email: 'nobody@example.com', code: '000000', purpose: 'login'},
          {ip: '1'},
        ),
      ),
    ).toBe('CODE_INVALID');
  });

  it('checks Turnstile and the blocklists', async () => {
    const send = (email: string, token = 'ok') =>
      code(
        h.rpc.sendCode(
          {email, purpose: 'signup', turnstileToken: token},
          {ip: '1.1.1.1'},
        ),
      );
    expect(await send('a@example.com', 'bad')).toBe('VALIDATION_FAILED');
    expect(await send('a@sub.mailinator.com')).toBe('VALIDATION_FAILED');
    await h.db
      .prepare(
        "INSERT INTO blocked_domain (domain, added_at) VALUES ('evil.test', 0)",
      )
      .run();
    expect(await send('x@evil.test')).toBe('VALIDATION_FAILED');
    const hmac =
      await h.services.accounts['secrets'].emailHmac('banned@example.com');
    await h.db
      .prepare(
        'INSERT INTO blocked_email (email_hmac, added_at) VALUES (?1, 0)',
      )
      .bind(hmac)
      .run();
    expect(await send('banned@example.com')).toBe('OK');
    expect(allMail(h).filter(m => m.to === 'banned@example.com')).toHaveLength(
      0,
    );
    expect(await send('not-an-email')).toBe('VALIDATION_FAILED');
  });
});

describe('code limits', () => {
  let h: Harness;
  const email = 'limits@example.com';
  const send = (hh: Harness) =>
    code(
      hh.rpc.sendCode(
        {email, purpose: 'signup', turnstileToken: 'ok'},
        {ip: '9.9.9.9'},
      ),
    );

  beforeEach(async () => {
    h = await createHarness(createTestD1('identity-access'));
  });

  it('throttles resends for 60 s and allows 5 sends per day', async () => {
    expect(await send(h)).toBe('OK');
    expect(await send(h)).toBe('OK'); // within 60 s: no new mail
    expect(allMail(h)).toHaveLength(1);
    for (let i = 0; i < 4; i++) {
      h.clock.advance(61_000);
      expect(await send(h)).toBe('OK');
    }
    expect(allMail(h)).toHaveLength(5);
    h.clock.advance(61_000);
    expect(await send(h)).toBe('RATE_LIMITED');
    h.clock.advance(DAY_MS);
    expect(await send(h)).toBe('OK');
  });

  it('allows 5 attempts per code', async () => {
    await send(h);
    const right = lastCode(h, email);
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      expect(
        await code(
          h.rpc.createSession(
            {email, code: wrong, purpose: 'signup'},
            {ip: '1'},
          ),
        ),
      ).toBe('CODE_INVALID');
    }
    // The code was dropped on its 5th failure.
    expect(
      await code(
        h.rpc.createSession({email, code: right, purpose: 'signup'}, {ip: '1'}),
      ),
    ).toBe('CODE_INVALID');
  });

  it('locks the address for 24 h after 10 failures', async () => {
    for (let round = 0; round < 2; round++) {
      h.clock.advance(61_000);
      await send(h);
      const right = lastCode(h, email);
      const wrong = right === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) {
        await code(
          h.rpc.createSession(
            {email, code: wrong, purpose: 'signup'},
            {ip: '1'},
          ),
        );
      }
    }
    h.clock.advance(61_000);
    expect(await send(h)).toBe('RATE_LIMITED');
    expect(
      await code(
        h.rpc.createSession(
          {email, code: '123456', purpose: 'signup'},
          {ip: '1'},
        ),
      ),
    ).toBe('RATE_LIMITED');
    h.clock.advance(DAY_MS);
    expect(await send(h)).toBe('OK');
    const s = await h.rpc.createSession(
      {email, code: lastCode(h, email), purpose: 'signup'},
      {ip: '1'},
    );
    expect(s.kind).toBe('session');
  });

  it('rejects expired codes', async () => {
    await send(h);
    h.clock.advance(11 * 60_000);
    expect(
      await code(
        h.rpc.createSession(
          {email, code: lastCode(h, email), purpose: 'signup'},
          {ip: '1'},
        ),
      ),
    ).toBe('CODE_INVALID');
  });
});

describe('sessions and refresh families', () => {
  let h: Harness;
  let s: IssuedSession;
  const email = 'bob@example.com';

  async function login(): Promise<IssuedSession> {
    h.clock.advance(61_000);
    await h.rpc.sendCode(
      {email, purpose: 'login', turnstileToken: 'ok'},
      {ip: '1'},
    );
    const r = await h.rpc.createSession(
      {email, code: lastCode(h, email), purpose: 'login'},
      {ip: '1', client: 'Firefox · Linux'},
    );
    if (r.kind !== 'session') throw new Error('expected session');
    return r;
  }

  beforeEach(async () => {
    h = await createHarness(createTestD1('identity-access'));
    s = await signup(h, email);
  });

  it('login keeps the trial end', async () => {
    h.clock.advance(HOUR_MS);
    const l = await login();
    expect(l.me.workspace.trialExpiresAt).toBe(s.me.workspace.trialExpiresAt);
    expect(l.me.sessions).toEqual({used: 2, limit: 3});
  });

  it('rotates refresh tokens and revokes the family on replay', async () => {
    const r1 = await h.rpc.refresh(s.refreshToken, {ip: '1'});
    expect(r1.refreshToken).not.toBe(s.refreshToken);
    const r2 = await h.rpc.refresh(r1.refreshToken, {ip: '1'});
    // Replaying the first token revokes the whole family.
    expect(await code(h.rpc.refresh(s.refreshToken, {ip: '1'}))).toBe(
      'UNAUTHENTICATED',
    );
    expect(await code(h.rpc.refresh(r2.refreshToken, {ip: '1'}))).toBe(
      'UNAUTHENTICATED',
    );
    expect(await code(h.rpc.refresh('garbage', {ip: '1'}))).toBe(
      'UNAUTHENTICATED',
    );
  });

  it('keeps at most 3 sessions per user (oldest evicted)', async () => {
    await login();
    await login();
    await login();
    expect(await code(h.rpc.refresh(s.refreshToken, {ip: '1'}))).toBe(
      'UNAUTHENTICATED',
    );
    expect(await count(h, 'SELECT COUNT(*) AS n FROM session')).toBe(3);
  });

  it('refresh re-reads the workspace: an expired trial → TRIAL_EXPIRED', async () => {
    await h.db
      .prepare(
        "UPDATE workspace SET status = 'EXPIRED', expired_at = 1 WHERE tenant_id = ?1",
      )
      .bind(s.me.workspace.tenantId)
      .run();
    expect(await code(h.rpc.refresh(s.refreshToken, {ip: '1'}))).toBe(
      'TRIAL_EXPIRED',
    );
    h.clock.advance(61_000);
    await h.rpc.sendCode(
      {email, purpose: 'login', turnstileToken: 'ok'},
      {ip: '1'},
    );
    expect(
      await code(
        h.rpc.createSession(
          {email, code: lastCode(h, email), purpose: 'login'},
          {ip: '1'},
        ),
      ),
    ).toBe('TRIAL_EXPIRED');
  });

  it('logout ends the session', async () => {
    const c = await claims(h, s.accessToken);
    await h.rpc.logout(ownerCtx(s), c.sid);
    expect(await code(h.rpc.refresh(s.refreshToken, {ip: '1'}))).toBe(
      'UNAUTHENTICATED',
    );
  });

  it('serves /me, validates time zones and reports the sessions quota', async () => {
    const ctx = ownerCtx(s);
    expect((await h.rpc.getMe(ctx)).email).toBe(email);
    const me = await h.rpc.patchMe(ctx, {
      locale: 'en-US',
      timeZone: 'Europe/Berlin',
    });
    expect(me).toMatchObject({locale: 'en-US', timeZone: 'Europe/Berlin'});
    expect(await code(h.rpc.patchMe(ctx, {timeZone: 'Mars/Olympus'}))).toBe(
      'VALIDATION_FAILED',
    );
    expect(await h.rpc.usage(ctx)).toEqual([
      {key: 'sessions', used: 1, limit: 3},
    ]);
  });

  it('exports JSON Lines of ExportRecord across the five services', async () => {
    const tid = s.me.workspace.tenantId;
    h.lifecycles.objects.rows.set(tid, 5);
    h.lifecycles.ontology.rows.set(tid, 1);
    const ctx = ownerCtx(s);
    let cursor: string | null = null;
    const lines: {file: string}[] = [];
    let calls = 0;
    do {
      const chunk = await h.rpc.exportChunk(ctx, cursor);
      for (const l of chunk.text.split('\n').filter(Boolean))
        lines.push(JSON.parse(l));
      cursor = chunk.nextCursor;
      calls++;
    } while (cursor && calls < 20);
    expect(lines.filter(l => l.file === 'objects.jsonl')).toHaveLength(5);
    expect(lines.map(l => l.file)).toContain('decisions.json');
    expect(calls).toBe(7); // ontology, integration, objects ×3, situation, decision
    expect(decodeCursor('x')).toBeNull();
    expect(await code(h.rpc.exportChunk(ctx, 'bad'))).toBe('VALIDATION_FAILED');
  });

  it('terminates the trial early with a terminate code', async () => {
    const ctx = ownerCtx(s);
    h.clock.advance(61_000);
    await h.rpc.sendMeCode(ctx, 'terminate');
    const m = allMail(h).pop()!;
    expect(m.template).toBe('code_terminate');
    expect(await code(h.rpc.terminateTrial(ctx, '000000'))).toBe(
      'CODE_INVALID',
    );
    h.clock.advance(61_000);
    await h.rpc.sendMeCode(ctx, 'terminate');
    await h.rpc.terminateTrial(ctx, lastCode(h, email));
    const w = await h.rpc.workspaceStatus(s.me.workspace.tenantId);
    expect(w).toEqual({kind: 'trial', status: 'EXPIRED'});
    expect(await count(h, 'SELECT COUNT(*) AS n FROM session')).toBe(0);
    expect(h.lifecycles.situation.closed).toEqual([
      {tid: s.me.workspace.tenantId, code: 4401},
    ]);
    const row = await h.db
      .prepare(
        'SELECT trial_expires_at, expired_at FROM workspace WHERE tenant_id = ?1',
      )
      .bind(s.me.workspace.tenantId)
      .first<{trial_expires_at: number; expired_at: number}>();
    expect(row!.trial_expires_at).toBe(h.clock.now().getTime());
    expect(row!.expired_at).toBe(h.clock.now().getTime());
    expect(
      await h.rpc.workspaceStatus('01K6A000000000000000000X99'),
    ).toBeNull();
  });
});
