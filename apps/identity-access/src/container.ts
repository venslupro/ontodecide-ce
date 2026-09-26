/**
 * @fileoverview Composition root of identity-access.
 */

import type {IdentityRpc} from '@ontodecide/identity/contract';
import type {
  BootstrapConfig,
  IdentityDeps,
} from '@ontodecide/identity/application';
import {
  D1AuditLog,
  D1TokenRepository,
  D1UserRepository,
  JwtTokenSigner,
  Pbkdf2PasswordHasher,
} from '@ontodecide/identity/infrastructure';
import {createIdentityRpc} from '@ontodecide/identity/interface';
import {
  createLogger,
  parseJwtKeys,
  systemClock,
  type Clock,
  type Logger,
} from '@ontodecide/shared-kernel';
import type {Env} from './env';

/** Test and environment overrides. */
export interface Overrides {
  clock?: Clock;
  logger?: Logger;
  /** PBKDF2 iterations (default 100,000; tests use ~1,000). */
  pbkdf2Iterations?: number;
}

/** Wired identity-access objects. */
export interface Container {
  deps: IdentityDeps;
  rpc: IdentityRpc;
}

/** Default tenant name for the bootstrap admin. */
export const DEFAULT_BOOTSTRAP_TENANT_NAME = 'OntoDecide';

function bootstrapConfig(env: Env): BootstrapConfig | undefined {
  const email = env.BOOTSTRAP_ADMIN_EMAIL?.trim();
  const password = env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return undefined;
  return {
    email,
    password,
    tenantName:
      env.BOOTSTRAP_TENANT_NAME?.trim() || DEFAULT_BOOTSTRAP_TENANT_NAME,
  };
}

/** Builds the container from bindings. */
export function createContainer(
  env: Env,
  overrides: Overrides = {},
): Container {
  const clock = overrides.clock ?? systemClock;
  const logger =
    overrides.logger ??
    createLogger({service: 'identity-access', env: env.ENVIRONMENT});
  const db = env.IDENTITY_DB;
  const deps: IdentityDeps = {
    users: new D1UserRepository(db),
    tokens: new D1TokenRepository(db),
    audit: new D1AuditLog(db, clock),
    hasher: new Pbkdf2PasswordHasher(overrides.pbkdf2Iterations),
    signer: new JwtTokenSigner(parseJwtKeys(env.JWT_SECRET)),
    clock,
    logger,
    bootstrap: bootstrapConfig(env),
  };
  return {deps, rpc: createIdentityRpc(deps)};
}
