/**
 * @fileoverview End-to-end admin and trial-end flows through the gateway:
 * bootstrap admin sign-in (e-mail code → setup code → passkey), Act-as with
 * audit, and the archive saga (修订说明书 9.9 验收): trial end → 16-minute
 * wait → one cron step per call → archive e-mail with a 7-day link → every
 * business database empty for the workspace → account gone → "delete now".
 */

import {describe, expect, it} from 'vitest';
import {FakeWebAuthn} from '../../packages/identity/infrastructure';
import {
  ADMIN_EMAIL,
  SETUP_CODE,
  createSystem,
  refreshCookie,
  rowsOf,
  signUp,
  type System,
} from './harness';

/** Signs the bootstrap admin in for the first time (binds passkey #1). */
async function adminFirstLogin(sys: System): Promise<string> {
  await sys.api('POST', '/auth/codes', {
    ip: '203.0.113.9',
    body: {email: ADMIN_EMAIL, purpose: 'login', turnstileToken: 'ok'},
  });
  const pre = await sys.api<{
    passkeyRequired: boolean;
    preAuth: string;
    setupRequired: boolean;
  }>('POST', '/auth/sessions', {
    ip: '203.0.113.9',
    body: {
      email: ADMIN_EMAIL,
      code: sys.lastCode(ADMIN_EMAIL),
      purpose: 'login',
    },
  });
  expect(pre.status).toBe(200);
  expect(pre.body).toMatchObject({passkeyRequired: true, setupRequired: true});

  const wrong = await sys.api('POST', '/auth/passkeys/setup-options', {
    ip: '203.0.113.9',
    body: {preAuth: pre.body.preAuth, setupCode: 'wrong-setup-code'},
  });
  expect(wrong.status).toBe(403);

  const opts = await sys.api<{challenge: string}>(
    'POST',
    '/auth/passkeys/setup-options',
    {
      ip: '203.0.113.9',
      body: {preAuth: pre.body.preAuth, setupCode: SETUP_CODE},
    },
  );
  expect(opts.status).toBe(200);
  const setup = await sys.api<{accessToken: string; total: number}>(
    'POST',
    '/auth/passkeys/setup',
    {
      ip: '203.0.113.9',
      body: {
        preAuth: pre.body.preAuth,
        setupCode: SETUP_CODE,
        credential: FakeWebAuthn.credential('pk-1', opts.body.challenge, {
          type: 'create',
        }),
      },
    },
  );
  expect(setup.status).toBe(201);
  expect(setup.body.total).toBe(1);
  expect(refreshCookie(setup)).toContain('__Host-od_rt=');
  const token = setup.body.accessToken;

  // With one passkey everything but passkey registration is refused.
  const early = await sys.api<{code: string; reason: string}>(
    'GET',
    '/admin/users',
    {token},
  );
  expect(early.status).toBe(403);
  expect(early.body.reason).toBe('PASSKEY_SETUP_INCOMPLETE');

  // Passkey #2 (with a step-up from #1) issues the 10 recovery codes.
  const so = await sys.api<{challenge: string}>(
    'POST',
    '/auth/passkeys/options',
    {token, body: {purpose: 'step_up'}},
  );
  const su = await sys.api<{stepUpToken: string}>(
    'POST',
    '/auth/passkeys/assertion',
    {
      token,
      body: {
        purpose: 'step_up',
        credential: FakeWebAuthn.credential('pk-1', so.body.challenge, {
          counter: 5,
        }),
      },
    },
  );
  expect(su.status).toBe(200);
  const ro = await sys.api<{challenge: string}>(
    'POST',
    '/admin/passkeys/options',
    {token, body: {}, headers: {'idempotency-key': 'e2e-pk-options-000001'}},
  );
  const pk2 = await sys.api<{total: number; recoveryCodes: string[]}>(
    'POST',
    '/admin/passkeys',
    {
      token,
      headers: {
        'x-step-up': su.body.stepUpToken,
        'idempotency-key': 'e2e-pk-add-0000000001',
      },
      body: {
        credential: FakeWebAuthn.credential('pk-2', ro.body.challenge, {
          type: 'create',
        }),
        label: 'backup',
      },
    },
  );
  expect(pk2.status).toBe(201);
  expect(pk2.body.total).toBe(2);
  expect(pk2.body.recoveryCodes).toHaveLength(10);
  return token;
}

describe('admin', () => {
  it('signs in with code + setup code + passkey and acts as a tenant with audit', async () => {
    const sys = await createSystem();
    const owner = await signUp(sys, 'owner@example.com');
    const admin = await adminFirstLogin(sys);

    const me = await sys.api<{role: string; workspace: {trialExpiresAt: null}}>(
      'GET',
      '/me',
      {token: admin},
    );
    expect(me.body.role).toBe('admin');
    expect(me.body.workspace.trialExpiresAt).toBeNull();

    const users = await sys.api<{items: {tenantId: string; email: string}[]}>(
      'GET',
      '/admin/users',
      {token: admin},
    );
    expect(users.status).toBe(200);
    expect(users.body.items).toEqual([
      expect.objectContaining({
        tenantId: owner.tid,
        email: 'owner@example.com',
      }),
    ]);
    // Owners never reach /admin.
    const denied = await sys.api('GET', '/admin/overview', {
      token: owner.token,
    });
    expect(denied.status).toBe(403);

    // Admin view: write into the owner's workspace; both steps are audited.
    const loaded = await sys.api('POST', '/workspace/sample-data', {
      token: admin,
      headers: {'x-act-as-tenant': owner.tid},
    });
    expect(loaded.status).toBe(202);
    expect(await rowsOf(sys.dbs.objects, 'og_object', owner.tid)).toBe(80);
    const log = await sys.api<{
      items: {action: string; targetTenantId: string}[];
      chainOk: boolean;
    }>('GET', '/admin/audit-log', {token: admin});
    expect(log.body.chainOk).toBe(true);
    const actions = log.body.items
      .filter(e => e.targetTenantId === owner.tid)
      .map(e => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(['act_as.enter', 'tenant.write']),
    );

    // The admin can never end its own trial.
    const term = await sys.api('POST', '/me/trial/termination', {
      token: admin,
      body: {code: '000000'},
    });
    expect(term.status).toBe(403);
  });
});

describe('trial end', () => {
  it('archives to B2, e-mails the link, purges every service and deletes the account', async () => {
    const sys = await createSystem();
    const owner = await signUp(sys, 'dora@example.com');
    await sys.api('POST', '/workspace/sample-data', {token: owner.token});
    await sys.drain();
    await sys.api('GET', '/situation/overview', {token: owner.token});
    await sys.api('PUT', '/object-types/Supplier', {
      token: owner.token,
      body: (
        await sys.api<{item: unknown}>('GET', '/object-types/Supplier', {
          token: owner.token,
        })
      ).body.item,
      headers: {'if-match': '"v0"'},
    });

    // Just before T + 72 h the owner refreshes and holds a valid token.
    sys.clock.advance(72 * 3_600_000 - 2 * 60_000);
    const fresh = await sys.api<{accessToken: string}>(
      'POST',
      '/auth/sessions/refresh',
      {cookie: owner.cookie},
    );
    expect(fresh.status).toBe(200);
    // T + 72 h: the gateway refuses the still-unexpired token at once (texp).
    sys.clock.advance(3 * 60_000);
    const expired = await sys.api<{code: string}>('GET', '/me', {
      token: fresh.body.accessToken,
    });
    expect(expired.status).toBe(401);
    expect(expired.body.code).toBe('TRIAL_EXPIRED');
    // The cron marks it EXPIRED and deletes the sessions.
    await sys.cronTick();
    const refresh = await sys.api('POST', '/auth/sessions/refresh', {
      cookie: refreshCookie(fresh),
    });
    expect(refresh.status).toBe(401);

    // Nothing happens during the 16-minute wait.
    await sys.cronTick();
    expect(sys.mails().some(m => m.template === 'archive_ready')).toBe(false);

    sys.clock.advance(17 * 60_000);
    let steps = 0;
    while (steps < 60) {
      sys.clock.advance(2 * 60_000);
      await sys.cronTick();
      steps++;
      const gone = await sys.dbs.identity
        .prepare('SELECT COUNT(*) AS n FROM workspace WHERE tenant_id = ?1')
        .bind(owner.tid)
        .first<{n: number}>();
      if (gone?.n === 0) break;
    }
    expect(steps).toBeGreaterThan(3);
    expect(steps).toBeLessThan(60);

    const mail = sys.mails().find(m => m.template === 'archive_ready');
    expect(mail).toBeDefined();
    expect(mail!.to).toBe('dora@example.com');
    expect(mail!.html).toContain('/archive-deletions/');

    // Only the ZIP and the PII-free archive index remain.
    const idx = await sys.dbs.identity
      .prepare(
        'SELECT object_key, size_bytes FROM archive_index WHERE tenant_id = ?1',
      )
      .bind(owner.tid)
      .first<{object_key: string; size_bytes: number}>();
    expect(idx?.object_key).toMatch(
      new RegExp(`^archives/${owner.tid}/[0-9a-f]{32}\\.zip$`),
    );
    expect(await sys.blobs.head(idx!.object_key)).toMatchObject({
      size: idx!.size_bytes,
    });
    expect(
      await sys.dbs.identity
        .prepare('SELECT COUNT(*) AS n FROM user_account')
        .first<{n: number}>(),
    ).toEqual({n: 1}); // only the admin
    for (const [db, table] of [
      [sys.dbs.objects, 'og_object'],
      [sys.dbs.objects, 'og_link'],
      [sys.dbs.integration, 'int_job'],
      [sys.dbs.decision, 'dec_scenario'],
      [sys.dbs.ontology, 'ont_workspace_schema'],
    ] as const) {
      expect(await rowsOf(db, table, owner.tid)).toBe(0);
    }

    // "Delete now" from the e-mail link removes the ZIP and the index.
    const token = /archive-deletions\/([A-Za-z0-9_-]+)/.exec(mail!.html)![1];
    const info = await sys.api<{sizeBytes: number}>(
      'GET',
      `/archive-deletions/${token}`,
    );
    expect(info.status).toBe(200);
    expect(info.body.sizeBytes).toBe(idx!.size_bytes);
    const del = await sys.api('POST', `/archive-deletions/${token}`, {
      headers: {'idempotency-key': 'e2e-delete-0000000001'},
    });
    expect(del.status).toBe(204);
    expect(await sys.blobs.head(idx!.object_key)).toBeNull();
    const again = await sys.api('GET', `/archive-deletions/${token}`);
    expect(again.status).toBe(404);
  });
});
