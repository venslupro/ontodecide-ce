/**
 * @fileoverview Identity: one-time e-mail codes. Only HMAC(pepper, e-mail +
 * code) is stored; comparison is constant-time; limits per 详细设计 6.3.5.
 */

import {
  AppError,
  constantTimeEqual,
  utcDay,
  type Clock,
  type Locale,
} from '@ontodecide/shared-kernel';
import {
  OTP,
  canResend,
  generateCode,
  onFailure,
  type CodePurpose,
} from '../../domain';
import type {NotificationService} from '../notification/notification_service';
import type {CodeRepository, PendingCode} from '../ports';
import type {Secrets} from '../secrets';

const TEMPLATE = {
  signup: 'code_signup',
  login: 'code_login',
  terminate: 'code_terminate',
} as const;

/** Options of {@link OtpService.issue}. */
export interface IssueOptions {
  email: string;
  emailHmac: string;
  purpose: CodePurpose;
  locale: Locale;
  /** Stored only for sign-up (the account does not exist yet). */
  emailEnc?: string;
  /**
   * False for a login code to an unknown address: the send quota is used as
   * usual (identical behaviour), but nothing is stored or sent.
   */
  deliver: boolean;
}

/** Issues and verifies codes. */
export class OtpService {
  constructor(
    private readonly codes: CodeRepository,
    private readonly secrets: Secrets,
    private readonly notification: NotificationService,
    private readonly clock: Clock,
  ) {}

  private now(): number {
    return this.clock.now().getTime();
  }

  /** RATE_LIMITED when the address is locked or its daily sends are used. */
  async assertCanSend(emailHmac: string): Promise<void> {
    const now = this.now();
    const l = await this.codes.limits(emailHmac, utcDay(new Date(now)));
    if (l.lockedUntil !== null && l.lockedUntil > now) {
      throw new AppError('RATE_LIMITED', 'EMAIL_LOCKED');
    }
    if (l.sends >= OTP.maxSendsPerDay) {
      throw new AppError('RATE_LIMITED', 'DAILY_SENDS_USED');
    }
  }

  /**
   * Issues a code (within the 60 s throttle nothing happens). Throws
   * RATE_LIMITED when the daily send quota is used and UNAVAILABLE when no
   * mail channel accepted the message.
   */
  async issue(o: IssueOptions): Promise<void> {
    const now = this.now();
    const existing = await this.codes.getPending(o.emailHmac, o.purpose);
    if (existing && !canResend(existing.expiresAt, now)) return;
    const day = utcDay(new Date(now));
    if (!(await this.codes.takeSend(o.emailHmac, day, OTP.maxSendsPerDay))) {
      throw new AppError('RATE_LIMITED', 'DAILY_SENDS_USED');
    }
    if (!o.deliver) return;
    const code = generateCode();
    const expiresAt = now + OTP.ttlMs;
    await this.codes.putPending(o.emailHmac, o.purpose, {
      codeHmac: await this.secrets.codeHmac(o.email, o.purpose, code),
      expiresAt,
      emailEnc: o.purpose === 'signup' ? (o.emailEnc ?? null) : null,
      locale: o.locale,
    });
    const r = await this.notification.send(
      TEMPLATE[o.purpose],
      o.email,
      o.locale,
      {code},
      `code:${o.purpose}:${o.emailHmac.slice(0, 24)}:${expiresAt}`,
    );
    if (!r.ok) throw new AppError('UNAVAILABLE', 'MAIL_UNAVAILABLE');
  }

  /**
   * Verifies a code. On success the pending code is returned (the caller
   * deletes it, possibly inside its own batch). On failure attempts and the
   * daily failures are counted: the 5th failure drops the code, the 10th of
   * the day locks the address for 24 h.
   */
  async verify(
    email: string,
    emailHmac: string,
    purpose: CodePurpose,
    code: string,
  ): Promise<PendingCode> {
    const now = this.now();
    const day = utcDay(new Date(now));
    const l = await this.codes.limits(emailHmac, day);
    if (l.lockedUntil !== null && l.lockedUntil > now) {
      throw new AppError('RATE_LIMITED', 'EMAIL_LOCKED');
    }
    const pending = await this.codes.getPending(emailHmac, purpose);
    const usable =
      pending !== null &&
      pending.expiresAt > now &&
      pending.attempts < OTP.maxAttemptsPerCode;
    const expected = await this.secrets.codeHmac(email, purpose, code);
    if (usable && pending && constantTimeEqual(expected, pending.codeHmac)) {
      return pending;
    }

    const attempts = usable
      ? await this.codes.bumpAttempts(emailHmac, purpose)
      : OTP.maxAttemptsPerCode;
    const failures = await this.codes.recordFailure(emailHmac, day);
    const outcome = onFailure(attempts, failures, now);
    if (pending && (outcome.dropCode || !usable)) {
      await this.codes.deletePending(emailHmac, purpose);
    }
    if (outcome.lockUntil !== null) {
      await this.codes.lock(emailHmac, day, outcome.lockUntil);
    }
    throw new AppError('CODE_INVALID');
  }

  /** Deletes a pending code after a successful verification. */
  consume(emailHmac: string, purpose: CodePurpose): Promise<void> {
    return this.codes.deletePending(emailHmac, purpose);
  }
}
