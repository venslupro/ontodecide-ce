/**
 * @fileoverview Test fixtures for platform data (me, tokens, admin).
 */

import type {
  AdminAuditDto,
  AdminUserRow,
  ArchiveIndexDto,
  PasskeyDto,
  PlatformOverview,
  PlatformSettings,
} from '@ontodecide/identity/contract';
import type {AccessClaims, Quotas} from '@ontodecide/shared-kernel';
import type {Me} from '../../entities/session/store';

/** Fixed "now" used by fixtures (2026-09-28T12:00:00Z). */
export const NOW = Date.parse('2026-09-28T12:00:00Z');

const HOUR = 3_600_000;

/** Owner tenant / user ids. */
export const OWNER_TID = 'ws-01J8ZOWNER00000000000000K4';
export const OWNER_UID = '01J8ZUSER0000000000000000A';
/** Admin tenant / user ids. */
export const ADMIN_TID = 'ws-01J8ZADMIN00000000000000AD';
export const ADMIN_UID = '01J8ZADMINUSER000000000000';

function b64url(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Builds an unsigned JWT-shaped token with the given claims. */
export function makeToken(claims: Partial<AccessClaims>, n = 0): string {
  const now = Math.floor(Date.now() / 1000);
  const full: AccessClaims = {
    sub: OWNER_UID,
    role: 'owner',
    tid: OWNER_TID,
    st: 'ACTIVE',
    texp: now + 30 * 3600,
    sid: 'sid-1',
    amr: ['otp'],
    iat: now,
    exp: now + 900,
    ...claims,
  };
  return `${b64url('{"alg":"EdDSA"}')}.${b64url(JSON.stringify(full))}.sig${n}`;
}

/** Owner access token. */
export const ownerToken = (n = 0) => makeToken({}, n);
/** Admin access token (no texp). */
export const adminToken = (n = 0) =>
  makeToken(
    {
      sub: ADMIN_UID,
      role: 'admin',
      tid: ADMIN_TID,
      texp: undefined,
      amr: ['otp', 'passkey'],
    },
    n,
  );

/** Personal quotas. */
export function quotas(): Quotas {
  return {
    objects: {used: 212, limit: 300},
    links: {used: 540, limit: 900},
    importRowsToday: {used: 1200, limit: 2000},
    aiRecsToday: {used: 1, limit: 3},
    mappingDraftsToday: {used: 0, limit: 2},
    sessions: {used: 2, limit: 3},
    resetsAt: '2026-09-29T00:00:00.000Z',
  };
}

/** GET /me of an owner whose trial ends `hoursLeft` from now. */
export function ownerMe(hoursLeft = 29): Me {
  const texp = Date.now() + hoursLeft * HOUR;
  return {
    userId: OWNER_UID,
    email: 'wang.yun@example.com',
    role: 'owner',
    locale: 'zh-CN',
    timeZone: 'Asia/Shanghai',
    workspace: {
      tenantId: OWNER_TID,
      kind: 'trial',
      status: 'ACTIVE',
      verifiedAt: new Date(texp - 72 * HOUR).toISOString(),
      trialExpiresAt: new Date(texp).toISOString(),
      expiredAt: null,
    },
    sessions: {used: 2, limit: 3},
    quotas: quotas(),
  };
}

/** GET /me of the admin. */
export function adminMe(passkeys = 2): Me {
  return {
    userId: ADMIN_UID,
    email: 'admin@example.com',
    role: 'admin',
    locale: 'zh-CN',
    timeZone: 'Asia/Shanghai',
    workspace: {
      tenantId: ADMIN_TID,
      kind: 'admin',
      status: 'ACTIVE',
      verifiedAt: '2026-09-01T00:00:00.000Z',
      trialExpiresAt: null,
      expiredAt: null,
    },
    sessions: {used: 1, limit: 3},
    passkeys,
    recoveryCodesLeft: 10,
    quotas: quotas(),
  };
}

/** GET /admin/overview. */
export function overview(): PlatformOverview {
  return {
    activeTrials: {used: 43, limit: 60},
    signupsToday: {used: 12, limit: 20},
    archives: {used: 96, limit: 140},
    purgeBacklog: {used: 1, limit: 10},
    signup: {state: 'open'},
    freeQuota: [
      {key: 'workers', used: 23140, limit: 100000},
      {key: 'd1Writes', used: 61020, limit: 100000},
      {key: 'neurons', used: 5800, limit: 10000},
      {key: 'queues', used: 2130, limit: 10000},
      {key: 'emailResend', used: 84, limit: 100},
    ],
    analyticsAt: '2026-09-28T11:00:00.000Z',
    recentActions: [
      {
        at: '2026-09-28T10:12:00.000Z',
        action: 'user.trial',
        target: 'ws-01J9AAAAAAAAAAAAAAAAAAA7Q',
        kind: 'modify',
      },
      {
        at: '2026-09-28T09:40:00.000Z',
        action: 'user.delete',
        target: null,
        kind: 'delete',
      },
    ],
  };
}

/** GET /admin/users rows. */
export function adminUsers(): AdminUserRow[] {
  const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
  return [
    {
      userId: 'u1',
      tenantId: 'ws-01J9AAAAAAAAAAAAAAAAAAAK4',
      email: 'wang.yun@example.com',
      status: 'ACTIVE',
      trialExpiresAt: at(29),
      zipExpiresAt: null,
      sessions: 2,
      banned: false,
      objects: 212,
      links: 540,
    },
    {
      userId: 'u2',
      tenantId: 'ws-01J9AAAAAAAAAAAAAAAAAAA7Q',
      email: 'li.na@corp.cn',
      status: 'ACTIVE',
      trialExpiresAt: at(59),
      zipExpiresAt: null,
      sessions: 1,
      banned: false,
      objects: 80,
      links: 160,
    },
    {
      userId: 'u3',
      tenantId: 'ws-01J8AAAAAAAAAAAAAAAAAAAP0',
      email: 'zhao.lei@qq.com',
      status: 'ARCHIVING',
      trialExpiresAt: at(-1),
      zipExpiresAt: null,
      sessions: 0,
      banned: false,
      objects: 64,
      links: 120,
    },
    {
      userId: null,
      tenantId: 'ws-01J8AAAAAAAAAAAAAAAAAAA2M',
      email: null,
      status: 'ARCHIVE_ONLY',
      trialExpiresAt: null,
      zipExpiresAt: at(6 * 24 - 1),
      sessions: 0,
      banned: false,
      objects: 0,
      links: 0,
    },
  ];
}

/** GET /admin/settings. */
export function settings(): PlatformSettings {
  return {
    signupEnabled: true,
    signupDailyLimit: 20,
    activeWorkspaceLimit: 60,
    trialHours: 72,
    archiveDays: 7,
    version: 3,
  };
}

/** GET /admin/archives rows. */
export function archives(): ArchiveIndexDto[] {
  return [
    {
      tenantId: 'ws-01J8AAAAAAAAAAAAAAAAAAA2M',
      sizeBytes: 412_000,
      sha256: 'a'.repeat(64),
      createdAt: '2026-09-27T12:00:00.000Z',
      expiresAt: '2026-10-04T12:00:00.000Z',
    },
  ];
}

/** GET /admin/audit-log rows. */
export function auditRows(): AdminAuditDto[] {
  return [
    {
      id: 'a1',
      at: '2026-09-28T10:12:00.000Z',
      action: 'user.trial',
      targetTenantId: 'ws-01J9AAAAAAAAAAAAAAAAAAA7Q',
      targetUserId: 'u2',
      reason: 'demo',
    },
  ];
}

/** GET /admin/passkeys. */
export function passkeys(): PasskeyDto[] {
  return [
    {
      id: 'pk1',
      label: 'MacBook',
      createdAt: '2026-09-01T00:00:00.000Z',
      lastUsedAt: '2026-09-28T08:00:00.000Z',
    },
    {
      id: 'pk2',
      label: 'YubiKey',
      createdAt: '2026-09-01T00:05:00.000Z',
      lastUsedAt: null,
    },
  ];
}
