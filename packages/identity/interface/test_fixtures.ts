/**
 * @fileoverview Test harness of identity-access (tests only): wires the
 * modules over a given D1 with a fixed clock, fake e-mail, fake
 * TenantLifecycle services, InMemoryBlobStore and FakeWebAuthn.
 */

import {
  AppError,
  FixedClock,
  generateSigningKey,
  type ArchiveFile,
  type LogLevel,
  type Logger,
  type ExportPage,
  type LifecycleService,
  type PurgeResult,
  type TenantLifecycleRpc,
} from '@ontodecide/shared-kernel';
import type {IdentityRpc, IssuedSession, PasskeyRequired} from '../contract';
import type {
  AnalyticsPort,
  EmailMessage,
  EmailSender,
  IdentityConfig,
  SendResult,
  TurnstileVerifier,
} from '../application';
import {
  FakeLinkSigner,
  FakeWebAuthn,
  InMemoryBlobStore,
} from '../infrastructure';
import {
  composeIdentity,
  type IdentityServices,
  type MailSetup,
} from './compose';
import {createIdentityRpc} from './identity_rpc';

/** One captured log line. */
export interface LogLine {
  level: LogLevel;
  msg: string;
  fields: Record<string, unknown>;
}

/** Logger that records every line (to assert alerts and the absence of PII). */
export class CaptureLogger implements Logger {
  constructor(readonly lines: LogLine[] = []) {}

  log(level: LogLevel, msg: string, fields: Record<string, unknown> = {}) {
    this.lines.push({level, msg, fields});
  }
  info(msg: string, fields?: Record<string, unknown>) {
    this.log('info', msg, fields);
  }
  warn(msg: string, fields?: Record<string, unknown>) {
    this.log('warn', msg, fields);
  }
  error(msg: string, fields?: Record<string, unknown>) {
    this.log('error', msg, fields);
  }
  child(): Logger {
    return this;
  }
}

/** A captured e-mail. */
export interface SentMail extends EmailMessage {
  key: string;
  channel: string;
}

/** Fake provider: records messages and answers with a scripted status. */
export class FakeEmailSender implements EmailSender {
  readonly sent: SentMail[] = [];
  /** Status of the next sends (FIFO); 200 when empty. */
  readonly script: number[] = [];
  /** Keys already accepted (provider-side idempotency). */
  readonly keys = new Set<string>();
  calls = 0;

  constructor(readonly name: string) {}

  async send(msg: EmailMessage, key: string): Promise<SendResult> {
    this.calls++;
    const status = this.script.shift() ?? 200;
    if (status >= 300) return {ok: false, status};
    if (this.keys.has(key)) return {ok: true, status: 200};
    this.keys.add(key);
    this.sent.push({...msg, key, channel: this.name});
    return {ok: true, status};
  }
}

/** Configurable Turnstile: every token except 'bad' passes. */
export class FakeTurnstile implements TurnstileVerifier {
  async verify(token: string): Promise<boolean> {
    return token !== 'bad';
  }
}

/** Rows held by one fake service, per tenant. */
export class FakeLifecycle implements TenantLifecycleRpc {
  readonly rows = new Map<string, number>();
  readonly tombstones = new Set<string>();
  readonly closed: {tid: string; code: number}[] = [];
  exportCalls = 0;
  private fail = 0;

  constructor(
    readonly file: ArchiveFile,
    private readonly pageRows = 2,
  ) {}

  /** Cancels pending injected failures. */
  clearFailures(): void {
    this.fail = 0;
  }

  /** Makes the next call throw. */
  failNext(times = 1): void {
    this.fail += times;
  }

  private check(): void {
    if (this.fail > 0) {
      this.fail--;
      throw new Error('injected lifecycle failure');
    }
  }

  async exportTenant(tid: string, cursor: string | null): Promise<ExportPage> {
    this.check();
    this.exportCalls++;
    const total = this.rows.get(tid) ?? 0;
    const start = cursor ? Number(cursor) : 0;
    if (!this.file.endsWith('.jsonl')) {
      return {
        file: this.file,
        text: JSON.stringify({rows: total}),
        nextCursor: null,
      };
    }
    const end = Math.min(total, start + this.pageRows);
    const lines: string[] = [];
    for (let i = start; i < end; i++) lines.push(JSON.stringify({n: i}));
    return {
      file: this.file,
      text: lines.map(l => l + '\n').join(''),
      nextCursor: end < total ? String(end) : null,
    };
  }

  async purgeTenant(tid: string, maxRows: number): Promise<PurgeResult> {
    this.check();
    const left = this.rows.get(tid) ?? 0;
    const deleted = Math.min(left, maxRows);
    this.rows.set(tid, left - deleted);
    const done = left - deleted === 0;
    if (done) this.tombstones.add(tid);
    return {deleted, done};
  }

  async countTenant(tid: string): Promise<number> {
    this.check();
    return this.rows.get(tid) ?? 0;
  }

  async closeStreams(tid: string, code: number): Promise<void> {
    this.closed.push({tid, code});
  }
}

/** The five fake services. */
export type FakeLifecycles = Record<LifecycleService, FakeLifecycle>;

/** Builds fake lifecycles (objects export in pages of 2 rows). */
export function fakeLifecycles(): FakeLifecycles {
  return {
    ontology: new FakeLifecycle('ontology.json'),
    integration: new FakeLifecycle('imports.json'),
    objects: new FakeLifecycle('objects.jsonl', 2),
    situation: new FakeLifecycle('situation.json'),
    decision: new FakeLifecycle('decisions.json'),
  };
}

/** Admin address and setup code used by the harness. */
export const ADMIN_EMAIL = 'root@ontodecide.test';
export const SETUP_CODE = 'setup-code-0123456789';

/** A wired identity-access for tests. */
export interface Harness {
  db: D1Database;
  clock: FixedClock;
  config: IdentityConfig;
  services: IdentityServices;
  rpc: IdentityRpc;
  blobs: InMemoryBlobStore;
  resend: FakeEmailSender;
  brevo: FakeEmailSender;
  lifecycles: FakeLifecycles;
  logger: CaptureLogger;
}

/** Optional adapters of {@link createHarness}. */
export interface HarnessExtras {
  analytics?: AnalyticsPort | null;
}

/** Creates a harness over a migrated identity-access D1. */
export async function createHarness(
  db: D1Database,
  overrides: Partial<IdentityConfig> = {},
  mail?: MailSetup,
  extras: HarnessExtras = {},
): Promise<Harness> {
  const clock = new FixedClock('2026-09-24T08:00:00Z');
  const config: IdentityConfig = {
    environment: 'test',
    appOrigin: 'https://app.test',
    mailFrom: 'OntoDecide <noreply@mail.test>',
    emailMode: 'live',
    trialHours: 72,
    archiveDays: 7,
    archiveDelayMin: 16,
    purgeBacklogLimit: 10,
    purgeRowsDaily: 30_000,
    maxSessions: 3,
    adminSessionHours: 8,
    resendDailyCap: 90,
    resendMonthlyCap: 2900,
    brevoDailyCap: 280,
    archiveLinkTtlS: 604_800,
    rpId: 'app.test',
    rpName: 'OntoDecide CE',
    signingKey: await generateSigningKey('test-1'),
    emailPepper: 'pepper',
    emailEncKey: 'enc-key',
    bootstrapAdminEmail: ADMIN_EMAIL,
    bootstrapSetupCode: SETUP_CODE,
    ...overrides,
  };
  const blobs = new InMemoryBlobStore();
  const resend = new FakeEmailSender('resend');
  const brevo = new FakeEmailSender('brevo');
  const lifecycles = fakeLifecycles();
  const logger = new CaptureLogger();
  const services = composeIdentity({
    db,
    config,
    clock,
    logger,
    lifecycles,
    blobs,
    signer: new FakeLinkSigner(),
    webauthn: new FakeWebAuthn(),
    turnstile: new FakeTurnstile(),
    mail: mail ?? {mode: 'live', resend, brevo},
    analytics: extras.analytics ?? null,
  });
  return {
    db,
    clock,
    config,
    services,
    rpc: createIdentityRpc(services),
    blobs,
    resend,
    brevo,
    lifecycles,
    logger,
  };
}

/** All mails captured by both providers, oldest first. */
export function allMail(h: Harness): SentMail[] {
  return [...h.resend.sent, ...h.brevo.sent];
}

/** The last 6-digit code mailed to an address. */
export function lastCode(h: Harness, to: string): string {
  const m = allMail(h)
    .filter(x => x.to === to && x.template.startsWith('code_'))
    .pop();
  const code = m && /\b(\d{6})\b/.exec(m.subject)?.[1];
  if (!code) throw new Error(`no code for ${to}`);
  return code;
}

/** Signs up an owner end to end. */
export async function signup(
  h: Harness,
  email: string,
  ip = '198.51.100.1',
): Promise<IssuedSession> {
  await h.rpc.sendCode({email, purpose: 'signup', turnstileToken: 'ok'}, {ip});
  const r = await h.rpc.createSession(
    {email, code: lastCode(h, email), purpose: 'signup'},
    {ip},
  );
  if (r.kind !== 'session') throw new AppError('INTERNAL', 'expected session');
  return r;
}

/** Admin e-mail code step → pre-auth. */
export async function adminPreAuth(h: Harness): Promise<PasskeyRequired> {
  h.clock.advance(61_000);
  await h.rpc.sendCode(
    {email: ADMIN_EMAIL, purpose: 'login', turnstileToken: 'ok'},
    {ip: '203.0.113.9'},
  );
  const r = await h.rpc.createSession(
    {email: ADMIN_EMAIL, code: lastCode(h, ADMIN_EMAIL), purpose: 'login'},
    {ip: '203.0.113.9'},
  );
  if (r.kind !== 'passkeyRequired') throw new Error('expected passkeyRequired');
  return r;
}

/** Reads the challenge from WebAuthn options. */
export function challengeOfOptions(o: Record<string, unknown>): string {
  return String(o['challenge']);
}
