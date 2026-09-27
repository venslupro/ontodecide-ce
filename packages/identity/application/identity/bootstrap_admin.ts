/**
 * @fileoverview Identity: idempotent creation of the single bootstrap admin
 * (修订说明书 6.4). Called at the start of every cron run and on the first
 * request of an isolate; the partial unique indexes make concurrent calls
 * create exactly one admin.
 */

import {ulid, type Clock, type Logger} from '@ontodecide/shared-kernel';
import type {AccountRepository} from '../ports';
import type {Secrets} from '../secrets';

/** Creates the admin from BOOTSTRAP_ADMIN_EMAIL when missing. */
export class BootstrapAdmin {
  private done = false;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly accounts: AccountRepository,
    private readonly secrets: Secrets,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly email: string | null,
  ) {}

  /** Ensures the admin exists (memoized per isolate once it does). */
  ensure(): Promise<void> {
    if (this.done) return Promise.resolve();
    this.inflight ??= this.run().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async run(): Promise<void> {
    if (await this.accounts.findAdmin()) {
      this.done = true;
      return;
    }
    if (!this.email) {
      this.logger.warn('identity.bootstrap_admin_unconfigured');
      return;
    }
    const now = this.clock.now().getTime();
    const created = await this.accounts.createAdmin({
      userId: ulid(now),
      tenantId: ulid(now),
      emailHmac: await this.secrets.emailHmac(this.email),
      emailEnc: await this.secrets.encryptEmail(this.email),
      now,
    });
    if (created || (await this.accounts.findAdmin())) {
      this.done = true;
      if (created) this.logger.info('identity.bootstrap_admin_created');
      return;
    }
    // The address is taken by an owner account: operations must resolve it.
    this.logger.error('identity.bootstrap_admin_conflict');
  }
}
