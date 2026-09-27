/**
 * @fileoverview Identity: e-mail code sign-up and sign-in (修订说明书 8,
 * 详细设计 6.11.6). `sendCode` answers identically whether or not the
 * address exists; sign-up creates the workspace and its owner in one D1
 * batch; the admin gets a pre-auth token and must complete a passkey step.
 */

import {
  AppError,
  HOUR_MS,
  parseOrThrow,
  ulid,
  utcDay,
  type CallCtx,
  type Clock,
  type Logger,
} from '@ontodecide/shared-kernel';
import {
  createSessionSchema,
  sendCodeSchema,
  type CreateSessionInput,
  type RequestMeta,
  type SendCodeInput,
  type SessionResult,
} from '../../contract';
import {trialUsable} from '../../domain';
import type {AdmissionService} from '../tenancy/admission_service';
import {signupIpKey} from '../tenancy/admission_service';
import type {WorkspaceDirectory} from '../tenancy/workspace_directory';
import type {PolicyService} from '../platform_admin/policy_service';
import type {PasskeyRepository, TurnstileVerifier} from '../ports';
import type {Secrets} from '../secrets';
import type {TokenService} from '../tokens';
import type {AccountService} from './account_service';
import type {OtpService} from './otp_service';
import type {SessionService} from './session_service';

/** Collaborators of {@link AuthService}. */
export interface AuthDeps {
  accounts: AccountService;
  otp: OtpService;
  sessions: SessionService;
  passkeys: PasskeyRepository;
  workspaces: WorkspaceDirectory;
  admission: AdmissionService;
  policy: PolicyService;
  turnstile: TurnstileVerifier;
  secrets: Secrets;
  tokens: TokenService;
  clock: Clock;
  logger: Logger;
  trialHours: number;
  purgeBacklogLimit: number;
}

/** Code-based authentication use cases. */
export class AuthService {
  constructor(private readonly d: AuthDeps) {}

  private now(): number {
    return this.d.clock.now().getTime();
  }

  /** POST /auth/codes. */
  async sendCode(raw: SendCodeInput, meta: RequestMeta): Promise<void> {
    const input = parseOrThrow(sendCodeSchema, raw);
    if (!(await this.d.turnstile.verify(input.turnstileToken, meta.ip))) {
      throw new AppError('VALIDATION_FAILED', 'TURNSTILE_FAILED', {
        extras: {
          errors: [{path: 'turnstileToken', message: 'TURNSTILE_FAILED'}],
        },
      });
    }
    const email = input.email;
    const emailHmac = await this.d.secrets.emailHmac(email);
    const refusal = await this.d.policy.emailRefusal(email, emailHmac);
    if (refusal === 'blocked_domain') {
      throw new AppError('VALIDATION_FAILED', 'EMAIL_DOMAIN_BLOCKED', {
        extras: {errors: [{path: 'email', message: 'EMAIL_DOMAIN_BLOCKED'}]},
      });
    }
    // A blocked address gets the same 202 but no code.
    if (refusal === 'blocked_email') return;
    await this.d.otp.assertCanSend(emailHmac);

    const locale = input.locale ?? 'zh-CN';
    if (input.purpose === 'signup') {
      const ipHmac = await this.d.secrets.ipHmac(meta.ip);
      const closed = await this.d.admission.precheck(ipHmac);
      if (closed) {
        this.d.logger.info('identity.signup_closed', {reason: closed});
        throw new AppError('SIGNUP_CLOSED');
      }
      const existing =
        await this.d.accounts.accounts.findByEmailHmac(emailHmac);
      await this.d.otp.issue({
        email,
        emailHmac,
        purpose: 'signup',
        locale,
        emailEnc: existing
          ? undefined
          : await this.d.secrets.encryptEmail(email),
        deliver: !existing,
      });
      return;
    }
    const account = await this.d.accounts.accounts.findByEmailHmac(emailHmac);
    await this.d.otp.issue({
      email,
      emailHmac,
      purpose: 'login',
      locale: account?.locale ?? locale,
      deliver: !!account && account.bannedAt === null,
    });
  }

  /** POST /auth/sessions. */
  async createSession(
    raw: CreateSessionInput,
    meta: RequestMeta,
  ): Promise<SessionResult> {
    const input = parseOrThrow(createSessionSchema, raw);
    const email = input.email;
    const emailHmac = await this.d.secrets.emailHmac(email);
    const pending = await this.d.otp.verify(
      email,
      emailHmac,
      input.purpose,
      input.code,
    );
    if (input.purpose === 'signup')
      return this.signup(emailHmac, pending, meta);

    const a = await this.d.accounts.accounts.findByEmailHmac(emailHmac);
    await this.d.otp.consume(emailHmac, 'login');
    if (!a || a.bannedAt !== null) throw new AppError('CODE_INVALID');
    if (a.role === 'admin') {
      return {
        kind: 'passkeyRequired',
        preAuth: await this.d.tokens.preAuth(a.userId),
        setupRequired: (await this.d.passkeys.count(a.userId)) === 0,
      };
    }
    const w = await this.d.workspaces.get(a.tenantId);
    if (!w || !trialUsable(w.status, w.trialExpiresAt, this.now())) {
      throw new AppError('TRIAL_EXPIRED');
    }
    return this.d.sessions.issue(a, w, ['otp'], meta);
  }

  private async signup(
    emailHmac: string,
    pending: {emailEnc: string | null; locale: string | null},
    meta: RequestMeta,
  ): Promise<SessionResult> {
    if (!pending.emailEnc) {
      await this.d.otp.consume(emailHmac, 'signup');
      throw new AppError('CODE_INVALID');
    }
    const now = this.now();
    const userId = ulid(now);
    const tenantId = ulid(now);
    const outcome = await this.d.accounts.accounts.signup({
      day: utcDay(new Date(now)),
      ipKey: signupIpKey(await this.d.secrets.ipHmac(meta.ip)),
      userId,
      tenantId,
      emailHmac,
      emailEnc: pending.emailEnc,
      locale: pending.locale === 'en-US' ? 'en-US' : 'zh-CN',
      now,
      trialExpiresAt: now + this.d.trialHours * HOUR_MS,
      purgeBacklogLimit: this.d.purgeBacklogLimit,
    });
    if (outcome === 'closed') throw new AppError('SIGNUP_CLOSED');
    if (outcome === 'duplicate') {
      await this.d.otp.consume(emailHmac, 'signup');
      throw new AppError('CODE_INVALID');
    }
    const a = await this.d.accounts.accounts.findById(userId);
    const w = await this.d.workspaces.get(tenantId);
    if (!a || !w) throw new AppError('INTERNAL', 'SIGNUP_NOT_VISIBLE');
    this.d.logger.info('identity.signup', {tid: tenantId, sub: userId});
    return this.d.sessions.issue(a, w, ['otp'], meta);
  }

  /** POST /me/codes (purpose terminate; owners only). */
  async sendMeCode(ctx: CallCtx, purpose: 'terminate'): Promise<void> {
    if (purpose !== 'terminate') throw new AppError('VALIDATION_FAILED');
    if (ctx.actor.role !== 'owner' || ctx.actor.actingAs) {
      throw new AppError('FORBIDDEN');
    }
    const a = await this.d.accounts.caller(ctx);
    if (a.role !== 'owner' || a.tenantId !== ctx.tid) {
      throw new AppError('FORBIDDEN');
    }
    await this.d.otp.assertCanSend(a.emailHmac);
    await this.d.otp.issue({
      email: await this.d.secrets.decryptEmail(a.emailEnc),
      emailHmac: a.emailHmac,
      purpose: 'terminate',
      locale: a.locale,
      deliver: true,
    });
  }
}
