/**
 * @fileoverview Session & client-global state (Zustand): user, in-memory
 * access token (never persisted), usage status and theme.
 */

import type {UserDto} from '@ontodecide/identity/contract';
import {hasRole, type Role, type UsageStatus} from '@ontodecide/shared-kernel';
import {create} from 'zustand';
import {readPrefs, writePrefs} from '../../shared/lib/prefs';

/** Signed-in user (subset of UserDto). */
export interface SessionUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: Role;
  markings: string[];
  locale: string;
  mustChangePassword: boolean;
}

/** Theme preference. */
export type ThemePref = 'light' | 'dark' | 'system';

/** Session state. */
export interface SessionState {
  status: 'unknown' | 'authenticated' | 'anonymous';
  user?: SessionUser;
  accessToken?: string;
  /** Epoch ms when the access token expires. */
  expiresAt?: number;
  usage: UsageStatus | null;
  theme: ThemePref;
  sidebarCollapsed: boolean;
  setGrant(grant: {
    accessToken: string;
    expiresIn: number;
    user?: unknown;
  }): void;
  setUser(user: UserDto | SessionUser): void;
  signOut(): void;
  setUsage(usage: UsageStatus): void;
  setTheme(theme: ThemePref): void;
  toggleSidebar(): void;
}

/** Maps a UserDto to the session user. */
export function toSessionUser(u: UserDto | SessionUser): SessionUser {
  return {
    id: u.id,
    tenantId: u.tenantId,
    email: u.email,
    name: u.name,
    role: u.role,
    markings: u.markings ?? [],
    locale: u.locale ?? 'zh-CN',
    mustChangePassword: !!u.mustChangePassword,
  };
}

const prefs = readPrefs();

/** Session store. */
export const useSession = create<SessionState>(set => ({
  status: 'unknown',
  usage: null,
  theme: prefs.theme ?? 'dark',
  sidebarCollapsed: !!prefs.sidebarCollapsed,
  setGrant(grant) {
    set(s => ({
      status: 'authenticated',
      accessToken: grant.accessToken,
      expiresAt: Date.now() + grant.expiresIn * 1000,
      user: grant.user ? toSessionUser(grant.user as UserDto) : s.user,
    }));
  },
  setUser(user) {
    set({user: toSessionUser(user)});
  },
  signOut() {
    set({
      status: 'anonymous',
      user: undefined,
      accessToken: undefined,
      expiresAt: undefined,
      usage: null,
    });
  },
  setUsage(usage) {
    set({usage});
  },
  setTheme(theme) {
    writePrefs({theme});
    set({theme});
  },
  toggleSidebar() {
    set(s => {
      writePrefs({sidebarCollapsed: !s.sidebarCollapsed});
      return {sidebarCollapsed: !s.sidebarCollapsed};
    });
  },
}));

/** Current role (undefined when signed out). */
export function useRole(): Role | undefined {
  return useSession(s => s.user?.role);
}

/** Whether the signed-in user holds at least `min`. */
export function useHasRole(min: Role): boolean {
  const role = useRole();
  return role ? hasRole([role], min) : false;
}

/** Non-hook role check. */
export function sessionHasRole(min: Role): boolean {
  const role = useSession.getState().user?.role;
  return role ? hasRole([role], min) : false;
}

/** Resolves the theme preference to a concrete theme. */
export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  if (typeof matchMedia === 'undefined') return 'dark';
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
