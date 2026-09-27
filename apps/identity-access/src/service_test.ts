/**
 * @fileoverview identity-access service module: env parsing, wiring over
 * the real migrations, Turnstile via fetch, EMAIL_MODE=log, the cron and
 * the TenantLifecycle bindings (as RPC stubs).
 */

import {describe, expect, it} from 'vitest';
import {
  FixedClock,
  generateSigningKey,
  type Logger,
  type TenantLifecycleRpc,
} from '@ontodecide/shared-kernel';
import {FetchMock, createTestD1, rpcBinding} from '@ontodecide/testing';
import {
  FakeWebAuthn,
  InMemoryBlobStore,
  FakeLinkSigner,
} from '@ontodecide/identity/infrastructure';
import {parseConfig} from './container';
import type {Env} from './env';
import {createService} from './service';

/** An empty data-owning service. */
function emptyLifecycle(): TenantLifecycleRpc {
  return {
    exportTenant: async () => ({
      file: 'ontology.json',
      text: '{}',
      nextCursor: null,
    }),
    purgeTenant: async () => ({deleted: 0, done: true}),
    countTenant: async () => 0,
    closeStreams: async () => {},
  };
}

async function testEnv(overrides: Partial<Env> = {}): Promise<Env> {
  return {
    IDENTITY_DB: createTestD1('identity-access'),
    LC_ONTOLOGY: rpcBinding(emptyLifecycle()),
    LC_INTEGRATION: rpcBinding(emptyLifecycle()),
    LC_OBJECTS: rpcBinding(emptyLifecycle()),
    LC_SITUATION: rpcBinding(emptyLifecycle()),
    LC_DECISION: rpcBinding(emptyLifecycle()),
    APP_ORIGIN: 'https://app.test/',
    MAIL_FROM: 'noreply@mail.test',
    EMAIL_MODE: 'log',
    B2_ARCHIVE_BUCKET: 'ontodecide-prd-archive',
    B2_ENDPOINT: 's3.us-west-004.backblazeb2.com',
    B2_REGION: 'us-west-004',
    WEBAUTHN_RP_ID: 'app.test',
    ENVIRONMENT: 'local',
    JWT_SIGNING_KEY: JSON.stringify(await generateSigningKey('k1')),
    EMAIL_PEPPER: 'pepper',
    EMAIL_ENC_KEY: 'enc',
    TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
    B2_WRITE_KEY_ID: 'w',
    B2_WRITE_APP_KEY: 'w',
    B2_SIGN_KEY_ID: 's',
    B2_SIGN_APP_KEY: 's',
    BOOTSTRAP_ADMIN_EMAIL: 'root@ontodecide.test',
    BOOTSTRAP_ADMIN_SETUP_CODE: 'setup-code-123456',
    ...overrides,
  };
}

function captureLogger(lines: Record<string, unknown>[]): Logger {
  const l: Logger = {
    log: (_lvl, msg, f) => lines.push({msg, ...f}),
    info: (msg, f) => lines.push({msg, ...f}),
    warn: (msg, f) => lines.push({msg, ...f}),
    error: (msg, f) => lines.push({msg, ...f}),
    child: () => l,
  };
  return l;
}

describe('identity-access service', () => {
  it('parses vars with defaults', async () => {
    const cfg = parseConfig(
      await testEnv({TRIAL_HOURS: '24', EMAIL_MODE: undefined}),
    );
    expect(cfg).toMatchObject({
      appOrigin: 'https://app.test',
      emailMode: 'live',
      trialHours: 24,
      archiveDelayMin: 16,
      maxSessions: 3,
      resendDailyCap: 90,
      archiveLinkTtlS: 604_800,
      rpName: 'OntoDecide CE',
    });
    await expect(
      testEnv({JWT_SIGNING_KEY: ''}).then(e => parseConfig(e)),
    ).rejects.toThrow();
  });

  it('signs up through Turnstile (fetch) and the log mailer, then runs the cron', async () => {
    const env = await testEnv();
    const lines: Record<string, unknown>[] = [];
    const f = new FetchMock(() => Response.json({success: true}));
    const svc = createService(env, {
      clock: new FixedClock('2026-09-24T08:00:00Z'),
      logger: captureLogger(lines),
      fetch: f.fetch,
      blobs: new InMemoryBlobStore(),
      signer: new FakeLinkSigner(),
      webauthn: new FakeWebAuthn(),
    });
    await svc.rpc.sendCode(
      {
        email: 'dev@example.com',
        purpose: 'signup',
        turnstileToken: 'XXXX.DUMMY',
      },
      {ip: '127.0.0.1'},
    );
    expect(f.calls[0].url).toContain('turnstile/v0/siteverify');
    const mail = lines.find(l => l['msg'] === 'mail.logged')!;
    expect(mail['to']).toBe('d***@example.com');
    expect(JSON.stringify(mail)).not.toContain('dev@example.com');
    const s = await svc.rpc.createSession(
      {email: 'dev@example.com', code: String(mail['code']), purpose: 'signup'},
      {ip: '127.0.0.1'},
    );
    expect(s.kind).toBe('session');
    // The first request created the bootstrap admin.
    const admins = await env.IDENTITY_DB.prepare(
      "SELECT COUNT(*) AS n FROM user_account WHERE role = 'admin'",
    ).first<{n: number}>();
    expect(admins!.n).toBe(1);
    await svc.scheduled!('*/2 * * * *', new Date('2026-09-24T08:02:00Z'));
    expect(lines.some(l => l['msg'] === 'identity.cron')).toBe(true);
    expect(lines.some(l => l['msg'] === 'identity.cron_stage_failed')).toBe(
      false,
    );
  });
});
