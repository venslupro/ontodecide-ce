/**
 * @fileoverview Platform admin endpoints (`/admin/*`, role admin only;
 * 前端详细设计 6.11 平台管理). Reads refresh every 60 s (no WebSocket). Every
 * write carries an Idempotency-Key created when the user confirms (the
 * caller passes it so network retries reuse it); high-risk writes carry the
 * passkey step-up token (`X-Step-Up`); settings also send If-Match.
 * Requests never carry X-Act-As-Tenant.
 */

import type {
  AdminAuditDto,
  AdminUserDto,
  AdminUserPatch,
  AdminUserRow,
  ArchiveIndexDto,
  PasskeyDto,
  PlatformOverview,
  PlatformSettings,
} from '@ontodecide/identity/contract';
import type {PageResult} from '@ontodecide/shared-kernel';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {api, apiRequest} from '../../shared/api/client';
import {qk, STALE} from '../../shared/api/query_keys';

/** Refresh interval of the platform page. */
export const ADMIN_REFRESH_MS = 60_000;

/** Page size of the admin lists. */
export const ADMIN_PAGE = 50;

const NO_ACT_AS = {noActAs: true} as const;

/** GET /admin/overview (60 s refresh). */
export function useAdminOverview() {
  return useQuery({
    queryKey: qk.admin('overview'),
    queryFn: () => api.get<PlatformOverview>('/admin/overview', NO_ACT_AS),
    refetchInterval: ADMIN_REFRESH_MS,
    staleTime: STALE.admin,
  });
}

/** GET /admin/users (cursor pages of 50, 60 s refresh). */
export function useAdminUsers(status?: string) {
  return useInfiniteQuery({
    queryKey: qk.admin('users', {status: status ?? null}),
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam}) =>
      api.get<PageResult<AdminUserRow>>('/admin/users', {
        ...NO_ACT_AS,
        query: {status, cursor: pageParam, limit: ADMIN_PAGE},
      }),
    getNextPageParam: last => last.nextCursor ?? undefined,
    refetchInterval: ADMIN_REFRESH_MS,
    staleTime: STALE.admin,
  });
}

/** GET /admin/users/{uid}. */
export function useAdminUser(uid: string | null) {
  return useQuery({
    queryKey: qk.admin('user', uid),
    queryFn: () =>
      api.get<AdminUserDto>(
        `/admin/users/${encodeURIComponent(uid!)}`,
        NO_ACT_AS,
      ),
    enabled: !!uid,
  });
}

/** GET /admin/archives. */
export function useAdminArchives() {
  return useInfiniteQuery({
    queryKey: qk.admin('archives'),
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam}) =>
      api.get<PageResult<ArchiveIndexDto>>('/admin/archives', {
        ...NO_ACT_AS,
        query: {cursor: pageParam, limit: ADMIN_PAGE},
      }),
    getNextPageParam: last => last.nextCursor ?? undefined,
    refetchInterval: ADMIN_REFRESH_MS,
  });
}

/** GET /admin/settings with its version (ETag, else body.version). */
export function useAdminSettings() {
  return useQuery({
    queryKey: qk.admin('settings'),
    queryFn: async () => {
      const r = await apiRequest<PlatformSettings>(
        '/admin/settings',
        NO_ACT_AS,
      );
      return {...r.data, version: r.version ?? r.data.version};
    },
    refetchInterval: ADMIN_REFRESH_MS,
  });
}

/** GET /admin/blocked-domains. */
export function useBlockedDomains(enabled: boolean) {
  return useQuery({
    queryKey: qk.admin('blocked'),
    queryFn: async () => {
      const r = await api.get<string[] | {domains: string[]}>(
        '/admin/blocked-domains',
        NO_ACT_AS,
      );
      return Array.isArray(r) ? r : (r?.domains ?? []);
    },
    enabled,
  });
}

/** GET /admin/audit-log (cursor pages; `chainOk` from the first page). */
export function useAuditLog(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: qk.admin('audit'),
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam}) =>
      api.get<PageResult<AdminAuditDto> & {chainOk: boolean}>(
        '/admin/audit-log',
        {...NO_ACT_AS, query: {cursor: pageParam, limit: ADMIN_PAGE}},
      ),
    getNextPageParam: last => last.nextCursor ?? undefined,
    enabled,
  });
}

/** GET /admin/passkeys. */
export function useAdminPasskeys(enabled: boolean) {
  return useQuery({
    queryKey: qk.admin('passkeys'),
    queryFn: async () => {
      const r = await api.get<PasskeyDto[] | {items: PasskeyDto[]}>(
        '/admin/passkeys',
        NO_ACT_AS,
      );
      return Array.isArray(r) ? r : (r?.items ?? []);
    },
    enabled,
  });
}

/** Write context: the key is reused for retries of one confirmation. */
export interface WriteCtx {
  idempotencyKey: string;
  stepUp?: string;
}

/** PATCH /admin/users/{uid} (step-up). */
export function patchUser(
  uid: string,
  patch: AdminUserPatch,
  w: WriteCtx,
): Promise<AdminUserDto> {
  return api.patch(`/admin/users/${encodeURIComponent(uid)}`, patch, {
    ...NO_ACT_AS,
    contentType: 'application/merge-patch+json',
    idempotencyKey: w.idempotencyKey,
    stepUp: w.stepUp,
  });
}

/** DELETE /admin/users/{uid}/sessions. */
export function revokeSessions(
  uid: string,
  w: WriteCtx,
): Promise<{revoked: number}> {
  return api.del(
    `/admin/users/${encodeURIComponent(uid)}/sessions`,
    undefined,
    {
      ...NO_ACT_AS,
      idempotencyKey: w.idempotencyKey,
    },
  );
}

/** DELETE /admin/users/{uid}?archive= (step-up; reason required). */
export function deleteUser(
  uid: string,
  archive: boolean,
  reason: string,
  w: WriteCtx,
): Promise<void> {
  return api.del(
    `/admin/users/${encodeURIComponent(uid)}`,
    {reason},
    {
      ...NO_ACT_AS,
      query: {archive},
      idempotencyKey: w.idempotencyKey,
      stepUp: w.stepUp,
    },
  );
}

/** POST /admin/archives/{tid}/download-link → 15-minute URL. */
export function archiveLink(
  tid: string,
  w: WriteCtx,
): Promise<{url: string; expiresAt: string}> {
  return api.post(
    `/admin/archives/${encodeURIComponent(tid)}/download-link`,
    undefined,
    {...NO_ACT_AS, idempotencyKey: w.idempotencyKey},
  );
}

/** DELETE /admin/archives/{tid} (step-up). */
export function deleteArchiveAdmin(tid: string, w: WriteCtx): Promise<void> {
  return api.del(`/admin/archives/${encodeURIComponent(tid)}`, undefined, {
    ...NO_ACT_AS,
    idempotencyKey: w.idempotencyKey,
    stepUp: w.stepUp,
  });
}

/** PATCH /admin/settings (If-Match + step-up). */
export function patchSettings(
  patch: Partial<
    Pick<
      PlatformSettings,
      'signupEnabled' | 'signupDailyLimit' | 'activeWorkspaceLimit'
    >
  >,
  version: number,
  w: WriteCtx,
): Promise<PlatformSettings> {
  return api.patch('/admin/settings', patch, {
    ...NO_ACT_AS,
    contentType: 'application/merge-patch+json',
    ifMatch: version,
    idempotencyKey: w.idempotencyKey,
    stepUp: w.stepUp,
  });
}

/** PUT /admin/blocked-domains. */
export function putBlockedDomains(
  domains: string[],
  w: WriteCtx,
): Promise<string[] | {domains: string[]}> {
  return api.put(
    '/admin/blocked-domains',
    {domains},
    {...NO_ACT_AS, idempotencyKey: w.idempotencyKey},
  );
}

/** DELETE /admin/passkeys/{id} (step-up; CONFLICT when < 2 would remain). */
export function deletePasskey(id: string, w: WriteCtx): Promise<void> {
  return api.del(`/admin/passkeys/${encodeURIComponent(id)}`, undefined, {
    ...NO_ACT_AS,
    idempotencyKey: w.idempotencyKey,
    stepUp: w.stepUp,
  });
}

/** Invalidates the platform queries after a write. */
export function invalidateAdmin(qc: QueryClient): Promise<void> {
  return qc.invalidateQueries({queryKey: ['admin']});
}

/** Hook form of {@link invalidateAdmin}. */
export function useInvalidateAdmin(): () => Promise<void> {
  const qc = useQueryClient();
  return () => invalidateAdmin(qc);
}
