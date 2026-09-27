/**
 * @fileoverview Identity: the bootstrap admin's passkeys (修订说明书 6.4,
 * 12.3). The first passkey needs the pre-auth token plus the one-time
 * BOOTSTRAP_ADMIN_SETUP_CODE; the second one yields 10 recovery codes (only
 * hashes stored); login and step-up use user-verifying assertions; sign
 * counters must increase; at least 2 passkeys must remain.
 */

import {
  AppError,
  type CallCtx,
  type Clock,
  type Logger,
} from '@ontodecide/shared-kernel';
import type {
  IssuedSession,
  PasskeyDto,
  PasskeyRegistered,
  RequestMeta,
  StepUpToken,
  WebAuthnJson,
} from '../../contract';
import {
  PASSKEY_RULES,
  SETUP_CODE_USED_FLAG,
  TOKEN_TTL,
  challengeOf,
  credentialIdOf,
  generateRecoveryCode,
  normalizeRecoveryCode,
  signCountOk,
} from '../../domain';
import type {NotificationService} from '../notification/notification_service';
import type {WorkspaceDirectory} from '../tenancy/workspace_directory';
import type {
  AccountRecord,
  ChallengePurpose,
  PasskeyRecord,
  PasskeyRepository,
  WebAuthnPort,
} from '../ports';
import {secretEquals, type Secrets} from '../secrets';
import type {TokenService} from '../tokens';
import type {AccountService} from './account_service';
import type {SessionService} from './session_service';

/** Collaborators of {@link PasskeyService}. */
export interface PasskeyDeps {
  passkeys: PasskeyRepository;
  webauthn: WebAuthnPort;
  accounts: AccountService;
  sessions: SessionService;
  workspaces: WorkspaceDirectory;
  notification: NotificationService;
  tokens: TokenService;
  secrets: Secrets;
  clock: Clock;
  logger: Logger;
  setupCode: string | null;
}

/** Authentication source of an admin call. */
export type PasskeyAuth = {preAuth: string} | {ctx: CallCtx};

function toDto(p: PasskeyRecord): PasskeyDto {
  return {
    id: p.credentialId,
    label: p.label,
    createdAt: new Date(p.createdAt).toISOString(),
    lastUsedAt:
      p.lastUsedAt === null ? null : new Date(p.lastUsedAt).toISOString(),
  };
}

/** Admin passkeys, recovery codes and step-up. */
export class PasskeyService {
  constructor(private readonly d: PasskeyDeps) {}

  private now(): number {
    return this.d.clock.now().getTime();
  }

  private async admin(userId: string): Promise<AccountRecord> {
    const a = await this.d.accounts.accounts.findById(userId);
    if (!a || a.role !== 'admin' || a.bannedAt !== null) {
      throw new AppError('UNAUTHENTICATED');
    }
    return a;
  }

  /** Resolves the admin behind a pre-auth token or an admin ctx. */
  async resolve(auth: PasskeyAuth): Promise<AccountRecord> {
    if ('preAuth' in auth && typeof auth.preAuth === 'string') {
      return this.admin(await this.d.tokens.verifyPreAuth(auth.preAuth));
    }
    const ctx = (auth as {ctx?: CallCtx}).ctx;
    if (!ctx || ctx.actor.role !== 'admin') throw new AppError('FORBIDDEN');
    return this.admin(ctx.actor.userId ?? ctx.sub);
  }

  /** The admin of an admin ctx (FORBIDDEN otherwise). */
  requireAdmin(ctx: CallCtx): Promise<AccountRecord> {
    if (ctx.actor.role !== 'admin') throw new AppError('FORBIDDEN');
    return this.admin(ctx.actor.userId ?? ctx.sub).catch(() => {
      throw new AppError('FORBIDDEN');
    });
  }

  private async checkSetupCode(
    userId: string,
    setupCode: string,
  ): Promise<void> {
    const configured = this.d.setupCode;
    const ok =
      configured !== null &&
      configured.length > 0 &&
      (await secretEquals(setupCode, configured));
    if (!ok) throw new AppError('FORBIDDEN', 'SETUP_CODE_INVALID');
    if (await this.d.passkeys.hasFlag(SETUP_CODE_USED_FLAG)) {
      throw new AppError('FORBIDDEN', 'SETUP_CODE_USED');
    }
    if ((await this.d.passkeys.count(userId)) > 0) {
      throw new AppError('FORBIDDEN', 'SETUP_DONE');
    }
  }

  private async registrationOptions(a: AccountRecord): Promise<WebAuthnJson> {
    const existing = await this.d.passkeys.list(a.userId);
    const email = await this.d.secrets.decryptEmail(a.emailEnc);
    const {options, challenge} = await this.d.webauthn.registrationOptions({
      userId: a.userId,
      userName: email,
      exclude: existing.map(p => ({
        id: p.credentialId,
        transports: p.transports,
      })),
    });
    await this.d.passkeys.putChallenge(
      challenge,
      a.userId,
      'register',
      this.now() + TOKEN_TTL.challengeMs,
    );
    return options;
  }

  private async consume(
    credential: WebAuthnJson,
    userId: string,
    purpose: ChallengePurpose,
  ): Promise<string> {
    const challenge = challengeOf(credential);
    if (
      !challenge ||
      !(await this.d.passkeys.consumeChallenge(
        challenge,
        userId,
        purpose,
        this.now(),
      ))
    ) {
      throw new AppError('UNAUTHENTICATED', 'CHALLENGE_INVALID');
    }
    return challenge;
  }

  private async verifyNew(
    a: AccountRecord,
    credential: WebAuthnJson,
    label: string | undefined,
  ): Promise<PasskeyRecord> {
    const challenge = await this.consume(credential, a.userId, 'register');
    const v = await this.d.webauthn.verifyRegistration(credential, challenge);
    if (!v) throw new AppError('UNAUTHENTICATED', 'PASSKEY_INVALID');
    if (await this.d.passkeys.find(v.credentialId)) {
      throw new AppError('CONFLICT', 'PASSKEY_EXISTS');
    }
    const rec: PasskeyRecord = {
      credentialId: v.credentialId,
      userId: a.userId,
      publicKey: v.publicKey,
      signCount: v.counter,
      transports: v.transports,
      label: label?.trim() || null,
      createdAt: this.now(),
      lastUsedAt: null,
    };
    return rec;
  }

  private async register(
    a: AccountRecord,
    credential: WebAuthnJson,
    label: string | undefined,
  ): Promise<PasskeyRecord> {
    const rec = await this.verifyNew(a, credential, label);
    await this.d.passkeys.insert(rec);
    return rec;
  }

  /** POST /auth/passkeys/setup-options. */
  async setupOptions(
    preAuth: string,
    setupCode: string,
  ): Promise<WebAuthnJson> {
    const a = await this.resolve({preAuth});
    await this.checkSetupCode(a.userId, setupCode);
    return this.registrationOptions(a);
  }

  /** POST /auth/passkeys/setup: first passkey → admin session. */
  async setup(
    preAuth: string,
    setupCode: string,
    credential: WebAuthnJson,
    meta: RequestMeta,
  ): Promise<PasskeyRegistered> {
    const a = await this.resolve({preAuth});
    await this.checkSetupCode(a.userId, setupCode);
    // Verify first, then burn the setup code, then store the passkey.
    const rec = await this.verifyNew(a, credential, 'setup');
    if (
      !(await this.d.passkeys.setFlagOnce(SETUP_CODE_USED_FLAG, this.now()))
    ) {
      throw new AppError('FORBIDDEN', 'SETUP_CODE_USED');
    }
    await this.d.passkeys.insert({...rec, lastUsedAt: this.now()});
    const session = await this.adminSession(
      a,
      ['otp', 'passkey'],
      meta,
      'passkey',
      true,
    );
    return {
      passkey: toDto({...rec, lastUsedAt: this.now()}),
      total: 1,
      session,
    };
  }

  /** POST /admin/passkeys/options. */
  async addOptions(ctx: CallCtx): Promise<WebAuthnJson> {
    return this.registrationOptions(await this.requireAdmin(ctx));
  }

  /**
   * POST /admin/passkeys. Needs a step-up — or none (empty string) while the
   * admin holds an unexpired recovery-code session.
   * When the admin reaches ≥ 2 passkeys without unused recovery codes, 10
   * new codes are returned once.
   */
  async add(
    ctx: CallCtx,
    credential: WebAuthnJson,
    label: string | undefined,
    stepUp: string | undefined,
  ): Promise<PasskeyRegistered> {
    const a = await this.requireAdmin(ctx);
    // After a recovery-code sign-in no passkey may be left for a step-up.
    const recovering = await this.d.sessions.recoverySessionActive(a.userId);
    if (!recovering)
      await this.d.tokens.verifyStepUp(stepUp || undefined, a.userId);
    const rec = await this.register(a, credential, label);
    const total = await this.d.passkeys.count(a.userId);
    const out: PasskeyRegistered = {passkey: toDto(rec), total};
    const stats = await this.d.passkeys.recoveryStats();
    if (total >= PASSKEY_RULES.minPasskeys && stats.unused === 0) {
      const codes = Array.from({length: PASSKEY_RULES.recoveryCodes}, () =>
        generateRecoveryCode(),
      );
      await this.d.passkeys.replaceRecoveryCodes(
        await Promise.all(
          codes.map(c => this.d.secrets.recoveryHash(normalizeRecoveryCode(c))),
        ),
      );
      out.recoveryCodes = codes;
    }
    return out;
  }

  /** GET /admin/passkeys. */
  async list(ctx: CallCtx): Promise<PasskeyDto[]> {
    const a = await this.requireAdmin(ctx);
    return (await this.d.passkeys.list(a.userId)).map(toDto);
  }

  /** DELETE /admin/passkeys/{id}: CONFLICT when fewer than 2 would remain. */
  async remove(
    ctx: CallCtx,
    id: string,
    stepUp: string | undefined,
  ): Promise<void> {
    const a = await this.requireAdmin(ctx);
    await this.d.tokens.verifyStepUp(stepUp, a.userId);
    const p = await this.d.passkeys.find(id);
    if (!p || p.userId !== a.userId) throw new AppError('NOT_FOUND');
    if (
      !(await this.d.passkeys.deleteKeeping(
        id,
        a.userId,
        PASSKEY_RULES.minPasskeys,
      ))
    ) {
      throw new AppError('CONFLICT', 'MIN_PASSKEYS');
    }
  }

  /** POST /auth/passkeys/options (login) and step-up options. */
  async assertionOptions(
    auth: PasskeyAuth,
    purpose: 'login' | 'step_up',
  ): Promise<WebAuthnJson> {
    const a = await this.authFor(auth, purpose);
    const keys = await this.d.passkeys.list(a.userId);
    if (keys.length === 0)
      throw new AppError('FORBIDDEN', 'PASSKEY_SETUP_REQUIRED');
    const {options, challenge} = await this.d.webauthn.authenticationOptions({
      allow: keys.map(p => ({id: p.credentialId, transports: p.transports})),
    });
    await this.d.passkeys.putChallenge(
      challenge,
      a.userId,
      purpose === 'login' ? 'assert' : 'step_up',
      this.now() + TOKEN_TTL.challengeMs,
    );
    return options;
  }

  private authFor(auth: PasskeyAuth, purpose: 'login' | 'step_up') {
    if (purpose === 'login' && !('preAuth' in auth)) {
      throw new AppError('UNAUTHENTICATED', 'PREAUTH_REQUIRED');
    }
    if (purpose === 'step_up' && !('ctx' in auth)) {
      throw new AppError('FORBIDDEN');
    }
    return this.resolve(auth);
  }

  /** POST /auth/passkeys/assertion. */
  async assertion(
    auth: PasskeyAuth,
    purpose: 'login' | 'step_up',
    credential: WebAuthnJson,
    meta: RequestMeta,
  ): Promise<IssuedSession | StepUpToken> {
    const a = await this.authFor(auth, purpose);
    const challenge = await this.consume(
      credential,
      a.userId,
      purpose === 'login' ? 'assert' : 'step_up',
    );
    const id = credentialIdOf(credential);
    const p = id ? await this.d.passkeys.find(id) : null;
    if (!p || p.userId !== a.userId) {
      throw new AppError('UNAUTHENTICATED', 'PASSKEY_UNKNOWN');
    }
    const v = await this.d.webauthn.verifyAuthentication(
      credential,
      challenge,
      p,
    );
    if (!v) throw new AppError('UNAUTHENTICATED', 'PASSKEY_INVALID');
    if (!signCountOk(p.signCount, v.newCounter)) {
      this.d.logger.warn('identity.passkey_counter_regression', {
        sub: a.userId,
      });
      throw new AppError('UNAUTHENTICATED', 'PASSKEY_COUNTER');
    }
    if (
      !(await this.d.passkeys.updateCounter(
        p.credentialId,
        p.signCount,
        v.newCounter,
        this.now(),
      ))
    ) {
      throw new AppError('UNAUTHENTICATED', 'PASSKEY_COUNTER');
    }
    if (purpose === 'step_up') {
      return {
        stepUpToken: await this.d.tokens.stepUp(a.userId),
        expiresIn: TOKEN_TTL.stepUpS,
      };
    }
    return this.adminSession(
      a,
      ['otp', 'passkey'],
      meta,
      'passkey',
      p.lastUsedAt === null,
    );
  }

  /** POST /auth/recovery: one-time recovery code instead of a passkey. */
  async recoveryLogin(
    preAuth: string,
    code: string,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const a = await this.resolve({preAuth});
    const hash = await this.d.secrets.recoveryHash(normalizeRecoveryCode(code));
    if (!(await this.d.passkeys.useRecoveryCode(hash, this.now()))) {
      throw new AppError('UNAUTHENTICATED', 'RECOVERY_CODE_INVALID');
    }
    return this.adminSession(a, ['otp', 'recovery'], meta, 'recovery', true);
  }

  private async adminSession(
    a: AccountRecord,
    amr: ('otp' | 'passkey' | 'recovery')[],
    meta: RequestMeta,
    method: 'passkey' | 'recovery',
    newDevice: boolean,
  ): Promise<IssuedSession> {
    const w = await this.d.workspaces.get(a.tenantId);
    if (!w) throw new AppError('INTERNAL', 'ADMIN_WORKSPACE_MISSING');
    const session = await this.d.sessions.issue(a, w, amr, meta);
    if (newDevice) {
      const c = await this.d.accounts.contactOf(a);
      const now = this.now();
      const r = await this.d.notification.send(
        'admin_new_device',
        c.email,
        c.locale,
        {at: now, timeZone: c.timeZone, client: meta.client ?? null, method},
        `admin_new_device:${session.me.userId}:${now}`,
      );
      if (!r.ok)
        this.d.logger.warn('identity.admin_notice_failed', {status: r.status});
    }
    return session;
  }

  /** Verifies a step-up token for the admin of ctx. */
  async verifyStepUp(
    ctx: CallCtx,
    stepUp: string | undefined,
  ): Promise<AccountRecord> {
    const a = await this.requireAdmin(ctx);
    await this.d.tokens.verifyStepUp(stepUp, a.userId);
    return a;
  }
}
