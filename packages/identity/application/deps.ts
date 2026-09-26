/**
 * @fileoverview Dependencies shared by the identity use-case handlers.
 */

import type {Clock, Logger} from '@ontodecide/shared-kernel';
import type {
  AuditLog,
  PasswordHasher,
  TokenRepository,
  TokenSigner,
  UserRepository,
} from './ports';

/** First-login bootstrap of the initial tenant and admin. */
export interface BootstrapConfig {
  email: string;
  password: string;
  tenantName: string;
}

/** Everything the handlers need. */
export interface IdentityDeps {
  users: UserRepository;
  tokens: TokenRepository;
  audit: AuditLog;
  hasher: PasswordHasher;
  signer: TokenSigner;
  clock: Clock;
  logger: Logger;
  /** Absent when bootstrap is not configured. */
  bootstrap?: BootstrapConfig;
}
