/**
 * @fileoverview Cron housekeeping across the modules' own tables: pending
 * codes (30 min after issue), old otp_limit days, expired sessions /
 * rotated hashes / challenges, tombstones after 48 h, admin_audit after 90
 * days, old usage counters.
 */

import {DAY_MS, utcDay, type Clock} from '@ontodecide/shared-kernel';
import {AUDIT_RETENTION_DAYS} from '../domain';
import type {
  AuditRepository,
  CodeRepository,
  PasskeyRepository,
  SessionRepository,
  UsageCounter,
  WorkspaceRepository,
} from './ports';

/** Days of usage_counter kept (monthly e-mail keys use `YYYY-MM`). */
const COUNTER_KEEP_DAYS = 40;

/** Table sweeps. */
export class HousekeepingService {
  constructor(
    private readonly codes: CodeRepository,
    private readonly sessions: SessionRepository,
    private readonly passkeys: PasskeyRepository,
    private readonly workspaces: WorkspaceRepository,
    private readonly audit: AuditRepository,
    private readonly usage: UsageCounter,
    private readonly clock: Clock,
  ) {}

  async run(): Promise<void> {
    const now = this.clock.now().getTime();
    await this.codes.sweep(now, utcDay(new Date(now - DAY_MS)));
    await this.sessions.sweep(now);
    await this.passkeys.sweepChallenges(now);
    await this.workspaces.sweepTombstones(now);
    await this.audit.sweep(now - AUDIT_RETENTION_DAYS * DAY_MS);
    await this.usage.sweep(utcDay(new Date(now - COUNTER_KEEP_DAYS * DAY_MS)));
  }
}
