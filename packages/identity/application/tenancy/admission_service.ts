/**
 * @fileoverview Sign-up admission (修订说明书 7.3): a read-only pre-check
 * before a sign-up code is sent. The binding check happens atomically in the
 * sign-up batch (AccountRepository.signup).
 */

import {utcDay, type Clock} from '@ontodecide/shared-kernel';
import {admissionRefusal, type AdmissionRefusal} from '../../domain';
import type {PolicyService} from '../platform_admin/policy_service';
import type {UsageCounter, WorkspaceRepository} from '../ports';

/** usage_counter key of the per-IP sign-up cap. */
export function signupIpKey(ipHmac: string): string {
  return `signup_ip:${ipHmac}`;
}

/** Read-only admission. */
export class AdmissionService {
  constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly usage: UsageCounter,
    private readonly policy: PolicyService,
    private readonly clock: Clock,
    private readonly purgeBacklogLimit: number,
  ) {}

  /** Null when a sign-up from this IP would currently be admitted. */
  async precheck(ipHmac: string): Promise<AdmissionRefusal | null> {
    const day = utcDay(this.clock.now());
    const [settings, signupsToday, closed, ip, activeTrials, purgeBacklog] =
      await Promise.all([
        this.policy.current(),
        this.usage.read(day, 'signup'),
        this.usage.read(day, 'signup_closed'),
        this.usage.read(day, signupIpKey(ipHmac)),
        this.workspaces.countTrials(['ACTIVE']),
        this.workspaces.countTrials(['EXPIRED', 'ARCHIVING']),
      ]);
    return admissionRefusal({
      signupEnabled: settings.signupEnabled,
      signupDailyLimit: settings.signupDailyLimit,
      signupsToday,
      activeWorkspaceLimit: settings.activeWorkspaceLimit,
      activeTrials,
      purgeBacklog,
      purgeBacklogLimit: this.purgeBacklogLimit,
      autoClosed: closed >= 1,
      signupsFromIpToday: ip,
    });
  }
}
