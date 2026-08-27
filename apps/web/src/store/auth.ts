/**
 * Zustand auth store.
 *
 * Wraps the auth API resource and persists access/refresh tokens to
 * `localStorage` under the key `ontodecide.tokens`. The store exposes a small
 * action surface used across the application: login, refresh, changePassword,
 * logout, hydrate and clear.
 *
 * {@link hydrate} is invoked as a module-level side-effect so that the
 * application restores any valid previous session before the first render.
 */

import { create } from 'zustand';
import { setSessionAccessor } from '@/services/api/client';
import * as authResource from '@/services/api/authResource';
import type {
  AuthTokens,
  LoginDto,
  RefreshDto,
  JwtPayload,
} from '@ontodecide/shared';
import { parseJwtPayload } from '@/lib/token';

const TOKENS_KEY = 'ontodecide.tokens';

/**
 * Tokens augmented with UI-side flags returned from the login response.
 */
export interface AuthTokensWithFlags extends AuthTokens {
  /** True when the user must rotate their password before other actions. */
  mustChangePassword?: boolean;
}

/**
 * Public shape of the auth store.
 */
export interface AuthState {
  /** True while a login / refresh / password action is in flight. */
  loading: boolean;
  /** Current access/refresh tokens or `null` when unauthenticated. */
  tokens: AuthTokens | null;
  /** Decoded JWT access-token payload or `null` when unauthenticated. */
  session: JwtPayload | null;
  /** Last user-visible error message or `null` when none. */
  errorMessage: string | null;
  /**
   * Authenticate a user.
   *
   * @param input Username and password credentials.
   * @returns Whether the authenticated user must change their password next.
   */
  login(input: LoginDto): Promise<{ needsPasswordChange: boolean }>;
  /**
   * Exchange the current refresh token for a fresh access token.
   */
  refresh(): Promise<void>;
  /**
   * Rotate the current user's password.
   *
   * @param current The current (old) password.
   * @param nextPwd The replacement password.
   */
  changePassword(current: string, nextPwd: string): Promise<void>;
  /**
   * Log out the user remotely and clear local state.
   */
  logout(): Promise<void>;
  /**
   * Load tokens from `localStorage`, decode the access token into the session
   * and wire the bearer token into the API client.
   */
  hydrate(): void;
  /**
   * Wipe local session data and detach the bearer token from the API client.
   */
  clear(): void;
}

/**
 * Decode tokens, persist them and refresh the API client accessor.
 *
 * The {@code tokensWithFlags} object — which includes the optional
 * {@code mustChangePassword} flag — is written to BOTH localStorage
 * and the React state so {@link useSession} reads a consistent value
 * across hydration and immediate redirects.
 */
function applyTokens(
  state: {
    setState: (
      patch: Partial<AuthState>,
      replace?: boolean | undefined,
    ) => void;
    getState: () => AuthState;
  },
  tokens: AuthTokens,
  mustChangePassword?: boolean,
): JwtPayload {
  const tokensWithFlags: AuthTokensWithFlags = { ...tokens };
  if (mustChangePassword !== undefined) {
    tokensWithFlags.mustChangePassword = mustChangePassword;
  }
  const session = parseJwtPayload<JwtPayload>(tokens.accessToken);
  localStorage.setItem(TOKENS_KEY, JSON.stringify(tokensWithFlags));
  setSessionAccessor(() => ({ tokens: tokensWithFlags }));
  state.setState({ tokens: tokensWithFlags, session });
  return session;
}

/**
 * Extract a friendly error message from a thrown value.
 */
function toErrorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  return 'Authentication error. Please try again.';
}

/**
 * Extract a "password change required" flag from a login response or JWT
 * payload on a best-effort basis so the UI can redirect the user.
 */
function extractNeedsChange(
  data: unknown,
  session: JwtPayload | null,
): boolean {
  if (session?.pwd_change_required === true) return true;
  if (data && typeof data === 'object') {
    const asRecord = data as Record<string, unknown>;
    if (asRecord.mustChangePassword === true) return true;
    if (asRecord.pwd_change_required === true) return true;
    if (asRecord.requirePasswordChange === true) return true;
    if (asRecord.needsPasswordChange === true) return true;
    if (asRecord.data && typeof asRecord.data === 'object') {
      const inner = asRecord.data as Record<string, unknown>;
      if (inner.mustChangePassword === true) return true;
      if (inner.pwd_change_required === true) return true;
      if (inner.requirePasswordChange === true) return true;
    }
  }
  return false;
}

/**
 * Zustand store creator.
 */
export const useAuthStore = create<AuthState>((set, get) => {
  // Wire the API client accessor to always read the latest tokens.
  setSessionAccessor(() => ({ tokens: get().tokens }));

  return {
    loading: false,
    tokens: null,
    session: null,
    errorMessage: null,

    hydrate() {
      const raw = localStorage.getItem(TOKENS_KEY);
      if (!raw) {
        setSessionAccessor(() => null);
        return;
      }
      try {
        const tokens = JSON.parse(raw) as AuthTokens;
        if (!tokens?.accessToken || !tokens.refreshToken) {
          localStorage.removeItem(TOKENS_KEY);
          setSessionAccessor(() => null);
          return;
        }
        const session = parseJwtPayload<JwtPayload>(tokens.accessToken);
        setSessionAccessor(() => ({ tokens: get().tokens }));
        set({ tokens, session, errorMessage: null });
      } catch {
        localStorage.removeItem(TOKENS_KEY);
        setSessionAccessor(() => null);
      }
    },

    clear() {
      localStorage.removeItem(TOKENS_KEY);
      setSessionAccessor(() => null);
      set({ tokens: null, session: null, errorMessage: null });
    },

    async login(input: LoginDto) {
      set({ loading: true, errorMessage: null });
      try {
        const response = await authResource.login(input);
        if (!response.success) {
          const msg =
            response.error?.message ??
            'Login failed. Please check your credentials.';
          throw new Error(msg);
        }
        const data = (response as { data?: AuthTokensWithFlags } | undefined)
          ?.data as AuthTokensWithFlags | undefined;
        if (!data) {
          throw new Error('Login failed. Missing tokens in response.');
        }
        const session = applyTokens(
          { setState: set, getState: get },
          data,
          data.mustChangePassword,
        );
        const needsPasswordChange = extractNeedsChange(response, session);
        set({ loading: false });
        return { needsPasswordChange };
      } catch (err) {
        set({ loading: false, errorMessage: toErrorMessage(err) });
        throw err;
      }
    },

    async refresh() {
      const current = get().tokens;
      if (!current?.refreshToken) {
        get().clear();
        return;
      }
      set({ loading: true, errorMessage: null });
      try {
        const payload: RefreshDto = { refreshToken: current.refreshToken };
        const response = await authResource.refresh(payload);
        if (!response.success) {
          get().clear();
          throw new Error(
            response.error?.message ??
            'Refresh failed. Please sign in again.',
          );
        }
        const data = (response as { data?: AuthTokens } | undefined)
          ?.data as AuthTokens | undefined;
        if (!data) {
          throw new Error('Refresh failed. Missing tokens in response.');
        }
        applyTokens({ setState: set, getState: get }, data);
        set({ loading: false });
      } catch (err) {
        get().clear();
        set({ loading: false, errorMessage: toErrorMessage(err) });
        throw err;
      }
    },

    async changePassword(current: string, nextPwd: string) {
      set({ loading: true, errorMessage: null });
      try {
        const response = await authResource.changePassword({
          currentPassword: current,
          newPassword: nextPwd,
        });
        if (!response.success) {
          const msg =
            response.error?.message ??
            'Could not update the password. Please try again.';
          throw new Error(msg);
        }
        const data = (response as { data?: AuthTokens } | undefined)
          ?.data as AuthTokens | undefined;
        if (data) {
          applyTokens({ setState: set, getState: get }, data, false);
        } else {
          const existing = get().session;
          const base = get().tokens;
          if (!existing || !base) {
            throw new Error(
              'Session or auth tokens are missing. Please log in again.',
            );
          }
          const nextSession: JwtPayload = {
            ...existing,
            pwd_change_required: false,
          };
          const nextTokens: AuthTokensWithFlags = {
            ...base,
            mustChangePassword: false,
          };
          localStorage.setItem(TOKENS_KEY, JSON.stringify(nextTokens));
          setSessionAccessor(() => ({ tokens: nextTokens }));
          set({ session: nextSession, tokens: nextTokens });
        }
        set({ loading: false });
      } catch (err) {
        set({ loading: false, errorMessage: toErrorMessage(err) });
        throw err;
      }
    },

    async logout() {
      set({ loading: true, errorMessage: null });
      try {
        await authResource.logout();
      } catch {
        // Remote logout failures must never prevent a local logout.
      } finally {
        get().clear();
        set({ loading: false });
      }
    },
  };
});

/**
 * Module-level hydration: restore tokens from persistent storage before any
 * consumer reads the store for the first time.
 */
useAuthStore.getState().hydrate();
