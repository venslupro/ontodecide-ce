/**
 * @fileoverview Identity: accounts, `GET/PATCH /me`, the `sessions` quota
 * and the contact data other modules need to send mail.
 */

import {
  AppError,
  isUserRole,
  type CallCtx,
  type Clock,
  type Locale,
  type QuotaItem,
} from '@ontodecide/shared-kernel';
import type {MeDto} from '../../contract';
import {
  toWorkspaceDto,
  type WorkspaceDirectory,
} from '../tenancy/workspace_directory';
import type {
  AccountRecord,
  AccountRepository,
  PasskeyRepository,
  SessionRepository,
} from '../ports';
import type {Secrets} from '../secrets';

/** Recipient data of an account. */
export interface Contact {
  userId: string;
  email: string;
  locale: Locale;
  timeZone: string;
}

/** Whether a string is a valid IANA time zone. */
export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', {timeZone: tz}).format(0);
    return true;
  } catch {
    return false;
  }
}

/** Account reads and profile updates. */
export class AccountService {
  constructor(
    readonly accounts: AccountRepository,
    private readonly sessions: SessionRepository,
    private readonly passkeys: PasskeyRepository,
    private readonly workspaces: WorkspaceDirectory,
    private readonly secrets: Secrets,
    private readonly clock: Clock,
    private readonly maxSessions: number,
  ) {}

  /** The human caller's own account (UNAUTHENTICATED when gone). */
  async caller(ctx: CallCtx): Promise<AccountRecord> {
    if (!isUserRole(ctx.actor.role)) throw new AppError('FORBIDDEN');
    const a = await this.accounts.findById(ctx.actor.userId ?? ctx.sub);
    if (!a || a.bannedAt !== null) throw new AppError('UNAUTHENTICATED');
    return a;
  }

  /** Builds MeDto. */
  async me(a: AccountRecord): Promise<MeDto> {
    const w = await this.workspaces.get(a.tenantId);
    if (!w) throw new AppError('UNAUTHENTICATED');
    const now = this.clock.now().getTime();
    const [email, used] = await Promise.all([
      this.secrets.decryptEmail(a.emailEnc),
      this.sessions.countActive(a.userId, now),
    ]);
    const me: MeDto = {
      userId: a.userId,
      email,
      role: a.role,
      locale: a.locale,
      timeZone: a.timeZone,
      workspace: toWorkspaceDto(w, a.verifiedAt),
      sessions: {used, limit: this.maxSessions},
    };
    if (a.role === 'admin') {
      const [count, rec] = await Promise.all([
        this.passkeys.count(a.userId),
        this.passkeys.recoveryStats(),
      ]);
      me.passkeys = count;
      me.recoveryCodesLeft = rec.unused;
    }
    return me;
  }

  /** PATCH /me. */
  async patchMe(
    ctx: CallCtx,
    patch: {locale?: Locale; timeZone?: string},
  ): Promise<MeDto> {
    const a = await this.caller(ctx);
    if (patch.timeZone !== undefined && !isTimeZone(patch.timeZone)) {
      throw new AppError('VALIDATION_FAILED', 'Unknown time zone', {
        extras: {errors: [{path: 'timeZone', message: 'Unknown time zone'}]},
      });
    }
    await this.accounts.updateProfile(a.userId, patch);
    return this.me({...a, ...patch});
  }

  /** `sessions` quota. */
  async usage(ctx: CallCtx): Promise<QuotaItem[]> {
    const a = await this.caller(ctx);
    const used = await this.sessions.countActive(
      a.userId,
      this.clock.now().getTime(),
    );
    return [{key: 'sessions', used, limit: this.maxSessions}];
  }

  /** Contact data of a workspace owner (null when the account is gone). */
  async contactOfTenant(tenantId: string): Promise<Contact | null> {
    const a = await this.accounts.findByTenant(tenantId);
    return a ? this.contactOf(a) : null;
  }

  /** Contact data of an account. */
  async contactOf(a: AccountRecord): Promise<Contact> {
    return {
      userId: a.userId,
      email: await this.secrets.decryptEmail(a.emailEnc),
      locale: a.locale,
      timeZone: a.timeZone,
    };
  }
}
