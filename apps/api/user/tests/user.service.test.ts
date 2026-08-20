/**
 * Unit tests for the UserManagementService domain service.
 *
 * Uses in-memory fakes for the repository interfaces, which is the whole
 * point of the dependency-inversion design — the service is fully testable
 * without a D1 binding.
 */
import {describe, it, expect, beforeEach} from 'vitest';
import {UserManagementService} from '../src/service/user.service.js';
import type {
  AuditEntry,
  IAuditRepository,
  IConfigRepository,
  IRefreshTokenRepository,
  IUserRepository,
  RefreshTokenRecord,
} from '../src/repository/user.repository.js';
import type {User} from '../src/domain/user.entity.js';
import type {UserSnapshot} from '../src/domain/user.entity.js';
import type {UserRole} from '../src/types/env.js';
import {
  hashPassword,
} from '@ontodecide/shared';

// ---------------------------------------------------------------------------
// In-memory fakes
// ---------------------------------------------------------------------------

class InMemoryUserRepo implements IUserRepository {
  public users = new Map<string, User & {_passwordHash: string}>();
  public deleted = new Set<string>();

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async findByUsername(username: string): Promise<User | null> {
    for (const u of this.users.values()) {
      if (u.username === username) return u;
    }
    return null;
  }

  async findByTenant(tenantId: string): Promise<User | null> {
    for (const u of this.users.values()) {
      if (u.tenantId === tenantId) return u;
    }
    return null;
  }

  async list(opts: {
    role?: string;
    offset?: number;
    limit?: number;
  } = {}): Promise<{total: number; items: UserSnapshot[]}> {
    let all = [...this.users.values()];
    if (opts.role) {
      all = all.filter((u) => u.role === opts.role);
    }
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? 50;
    const page = all.slice(offset, offset + limit);
    return {
      total: all.length,
      items: page.map((u) => u.snapshot()),
    };
  }

  async save(user: User): Promise<void> {
    this.users.set(user.id, user as unknown as User & {_passwordHash: string});
  }

  async delete(id: string): Promise<void> {
    this.users.delete(id);
    this.deleted.add(id);
  }

  async count(): Promise<number> {
    return this.users.size;
  }
}

class InMemoryAuditRepo implements IAuditRepository {
  public entries: AuditEntry[] = [];

  async record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }

  async listForTenant(
      tenantId: string,
      opts?: {offset?: number; limit?: number},
  ): Promise<{total: number; items: AuditEntry[]}> {
    const filtered = this.entries.filter((e) => e.tenantId === tenantId);
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? 50;
    return {
      total: filtered.length,
      items: filtered.slice(offset, offset + limit),
    };
  }
}

class InMemoryRefreshRepo implements IRefreshTokenRepository {
  public tokens = new Map<string, RefreshTokenRecord>();

  async save(token: RefreshTokenRecord): Promise<void> {
    this.tokens.set(token.jti, token);
  }

  async find(jti: string): Promise<RefreshTokenRecord | null> {
    return this.tokens.get(jti) ?? null;
  }

  async revoke(jti: string): Promise<void> {
    const t = this.tokens.get(jti);
    if (t) {
      this.tokens.set(jti, {...t, revoked: true});
    }
  }

  async revokeAllForUser(userId: string): Promise<void> {
    for (const [jti, t] of this.tokens) {
      if (t.userId === userId) {
        this.tokens.set(jti, {...t, revoked: true});
      }
    }
  }
}

class InMemoryConfigRepo implements IConfigRepository {
  public config: Record<string, string>;

  constructor(config: Record<string, string> = {}) {
    this.config = config;
  }

  async get(key: string): Promise<string | null> {
    return this.config[key] ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.config[key] = value;
  }

  async all(): Promise<Record<string, string>> {
    return {...this.config};
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeService(config: Record<string, string> = {}) {
  const users = new InMemoryUserRepo();
  const audit = new InMemoryAuditRepo();
  const refresh = new InMemoryRefreshRepo();
  const configRepo = new InMemoryConfigRepo(config);
  const service = new UserManagementService(users, audit, refresh, configRepo);
  return {service, users, audit, refresh, configRepo};
}

const auditCtx = {
  operatorId: 'admin',
  operatorTenantId: 'tenant_test',
  ip: '127.0.0.1',
  userAgent: 'vitest',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UserManagementService.createUser', () => {
  it('creates a user with a temporary password', async () => {
    const {service, users} = makeService();
    const result = await service.createUser(
        {username: 'alice'}, auditCtx);

    expect(result.user.username).toBe('alice');
    expect(result.user.role).toBe('analyst');
    expect(result.temporaryPassword).toHaveLength(16);
    expect(await users.findByUsername('alice')).not.toBeNull();
  });

  it('respects the max_users cap', async () => {
    const {service} = makeService({max_users: '1'});
    await service.createUser({username: 'first'}, auditCtx);
    await expect(service.createUser({username: 'second'}, auditCtx))
        .rejects.toThrow('Maximum of 1 users reached.');
  });

  it('rejects a duplicate username', async () => {
    const {service} = makeService();
    await service.createUser({username: 'dup'}, auditCtx);
    await expect(service.createUser({username: 'dup'}, auditCtx))
        .rejects.toThrow('Username \'dup\' is taken.');
  });

  it('respects the provided role override', async () => {
    const {service} = makeService();
    const {user} = await service.createUser(
        {username: 'bob', role: 'viewer'}, auditCtx);
    expect(user.role).toBe('viewer');
  });

  it('writes an audit log entry on create', async () => {
    const {service, audit} = makeService();
    await service.createUser({username: 'audited'}, auditCtx);
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0].action).toBe('create_user');
  });
});

describe('UserManagementService.login', () => {
  it('authenticates with the correct password', async () => {
    const {service} = makeService();
    const {temporaryPassword} = await service.createUser(
        {username: 'alice'}, auditCtx);
    const user = await service.login('alice', temporaryPassword, auditCtx);
    expect(user.username).toBe('alice');
    expect(user.snapshot().state).not.toBe('pending');
  });

  it('throws on a wrong password', async () => {
    const {service} = makeService();
    await service.createUser({username: 'alice'}, auditCtx);
    await expect(service.login('alice', 'wrong-password', auditCtx))
        .rejects.toThrow('Invalid credentials.');
  });

  it('throws on a non-existent user', async () => {
    const {service} = makeService();
    await expect(service.login('ghost', 'pw', auditCtx))
        .rejects.toThrow('Invalid credentials.');
  });
});

describe('UserManagementService.setStatus', () => {
  it('disables a user', async () => {
    const {service} = makeService();
    const {user} = await service.createUser({username: 'bob'}, auditCtx);
    const updated = await service.setStatus(user.id, false, auditCtx);
    expect(updated.snapshot().isActive).toBe(false);
  });

  it('re-enables a disabled user', async () => {
    const {service} = makeService();
    const {user} = await service.createUser({username: 'bob'}, auditCtx);
    await service.setStatus(user.id, false, auditCtx);
    const reEnabled = await service.setStatus(user.id, true, auditCtx);
    expect(reEnabled.snapshot().isActive).toBe(true);
  });

  it('throws when disabling a bootstrap admin', async () => {
    const {service, users} = makeService();
    // Simulate a bootstrap admin row.
    const adminHash = await hashPassword('admin-pw');
    const admin = {
      id: 'admin-1',
      tenantId: 'tenant_admin',
      username: 'admin',
      passwordHash: adminHash,
      email: null,
      role: 'admin' as UserRole,
      isActive: true,
      isDataCleared: false,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
      lastCleanupAt: null,
      dataRetentionDays: 30,
      dataSizeEstimate: 0,
      // Entity methods (we only need disable for this test)
      snapshot: () => ({
        id: 'admin-1', tenantId: 'tenant_admin', username: 'admin',
        email: null, role: 'admin', isActive: true, isDataCleared: false,
        state: 'active', createdAt: new Date().toISOString(),
        lastLoginAt: null, lastCleanupAt: null,
        dataRetentionDays: 30, dataSizeEstimate: 0,
      }),
    };
    // The User entity's disable() throws for admin role — we test via
    // the service which calls user.disable().
    await users.save(admin as unknown as User);
    await expect(service.setStatus('admin-1', false, auditCtx))
        .rejects.toThrow();
  });
});

describe('UserManagementService.resetPassword', () => {
  it('resets the password and revokes all refresh tokens', async () => {
    const {service, refresh} = makeService();
    const {user, temporaryPassword} = await service.createUser(
        {username: 'alice'}, auditCtx);
    // Issue a refresh token.
    await service.issueRefreshToken(user);
    const newPw = await service.resetPassword(user.id, auditCtx);
    expect(newPw).toHaveLength(16);
    expect(newPw).not.toBe(temporaryPassword);
    // All refresh tokens should be revoked.
    for (const t of refresh.tokens.values()) {
      expect(t.revoked).toBe(true);
    }
  });

  it('throws for a non-existent user', async () => {
    const {service} = makeService();
    await expect(service.resetPassword('ghost-id', auditCtx))
        .rejects.toThrow('User ghost-id not found.');
  });
});

describe('UserManagementService.deleteUser', () => {
  it('soft-deletes a user and revokes tokens', async () => {
    const {service, users, refresh} = makeService();
    const {user} = await service.createUser({username: 'bob'}, auditCtx);
    await service.issueRefreshToken(user);
    await service.deleteUser(user.id, auditCtx);
    expect(await users.findById(user.id)).toBeNull();
    for (const t of refresh.tokens.values()) {
      expect(t.revoked).toBe(true);
    }
  });

  it('throws when deleting the bootstrap admin', async () => {
    const {service, users} = makeService();
    const adminHash = await hashPassword('admin-pw');
    const admin = {
      id: 'admin-1',
      tenantId: 'tenant_admin',
      username: 'admin',
      passwordHash: adminHash,
      email: null,
      role: 'admin' as UserRole,
      isActive: true,
      isDataCleared: false,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
      lastCleanupAt: null,
      dataRetentionDays: 30,
      dataSizeEstimate: 0,
      snapshot: () => ({
        id: 'admin-1', tenantId: 'tenant_admin', username: 'admin',
        email: null, role: 'admin', isActive: true, isDataCleared: false,
        state: 'active', createdAt: new Date().toISOString(),
        lastLoginAt: null, lastCleanupAt: null,
        dataRetentionDays: 30, dataSizeEstimate: 0,
      }),
    };
    await users.save(admin as unknown as User);
    await expect(service.deleteUser('admin-1', auditCtx))
        .rejects.toThrow('Cannot delete the bootstrap admin.');
  });
});

describe('UserManagementService.getUser', () => {
  it('returns the user entity', async () => {
    const {service} = makeService();
    const {user} = await service.createUser({username: 'alice'}, auditCtx);
    const found = await service.getUser(user.id);
    expect(found.id).toBe(user.id);
  });

  it('throws for a non-existent user', async () => {
    const {service} = makeService();
    await expect(service.getUser('ghost')).rejects.toThrow();
  });
});

describe('UserManagementService.listUsers', () => {
  it('returns a paginated list', async () => {
    const {service} = makeService();
    for (let i = 0; i < 5; i++) {
      await service.createUser({username: `user${i}`}, auditCtx);
    }
    const {total, items} = await service.listUsers({page: 1, size: 3});
    expect(total).toBe(5);
    expect(items).toHaveLength(3);
  });
});

describe('UserManagementService.config', () => {
  it('sets and gets a config value', async () => {
    const {service} = makeService();
    await service.setConfig('key', 'value', auditCtx);
    const all = await service.getAllConfig();
    expect(all['key']).toBe('value');
  });
});

describe('UserManagementService.listAudit', () => {
  it('returns audit entries for a tenant', async () => {
    const {service} = makeService();
    const {user} = await service.createUser({username: 'alice'}, auditCtx);
    const {total, items} = await service.listAudit(user.tenantId, {});
    expect(total).toBe(1);
    expect(items[0].action).toBe('create_user');
  });
});

describe('UserManagementService.refreshToken', () => {
  it('issues and revokes a refresh token', async () => {
    const {service, refresh} = makeService();
    const {user} = await service.createUser({username: 'alice'}, auditCtx);
    const {jti} = await service.issueRefreshToken(user);
    expect(refresh.tokens.has(jti)).toBe(true);
    await service.revokeRefreshToken(jti);
    expect(refresh.tokens.get(jti)!.revoked).toBe(true);
  });
});
