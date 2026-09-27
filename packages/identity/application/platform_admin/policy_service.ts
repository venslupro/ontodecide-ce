/**
 * @fileoverview PlatformAdmin policy reads used by the other modules:
 * platform settings and the e-mail / domain blocklists.
 */

import {domainCandidates, emailDomain, isDisposableDomain} from '../../domain';
import type {SettingsRepository, SettingsValues} from '../ports';

/** Why an address may not receive codes. */
export type EmailRefusal = 'blocked_domain' | 'blocked_email' | null;

/** Settings and blocklist checks. */
export class PolicyService {
  constructor(private readonly settings: SettingsRepository) {}

  /** Current platform settings. */
  current(): Promise<SettingsValues> {
    return this.settings.get();
  }

  /** Checks the built-in and admin blocklists for a normalized address. */
  async emailRefusal(email: string, emailHmac: string): Promise<EmailRefusal> {
    const domain = emailDomain(email);
    if (isDisposableDomain(domain)) return 'blocked_domain';
    if (await this.settings.anyDomainBlocked(domainCandidates(domain))) {
      return 'blocked_domain';
    }
    if (await this.settings.isEmailBlocked(emailHmac)) return 'blocked_email';
    return null;
  }
}
