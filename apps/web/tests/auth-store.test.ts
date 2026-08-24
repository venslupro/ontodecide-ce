/**
 * Unit tests for the Zustand auth store.
 *
 * The tests mock the auth API resource and the JWT token parser to isolate
 * the store logic; they use dynamic imports so each case gets a freshly
 * hydrated Zustand instance.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const TOKENS_KEY = 'ontodecide.tokens';

/**
 * Reset shared state before each test so that mocks and the persisted token
 * cache are fully independent.
 */
beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  vi.resetModules();
});

describe('auth store', () => {
  it('login persists access and refresh tokens to localStorage', async () => {
    const accessToken = 'access.token.value';
    const refreshToken = 'refresh.token.value';
    const expiresIn = 3600;

    vi.doMock('@/services/api/authResource', () => ({
      login: vi.fn().mockResolvedValue({
        success: true,
        data: { accessToken, refreshToken, expiresIn },
      }),
      refresh: vi.fn(),
      changePassword: vi.fn(),
      logout: vi.fn(),
    }));

    vi.doMock('@/lib/token', () => ({
      parseJwtPayload: vi.fn().mockReturnValue({
        user_id: 'u_1',
        tenant_id: 'tenant_1',
        username: 'alice',
        role: 'admin',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        jti: 'jti_1',
      }),
    }));

    vi.doMock('@/services/api/client', () => ({
      setSessionAccessor: vi.fn(),
    }));

    const { useAuthStore } = await import('@/store/auth');

    const result = await useAuthStore.getState().login({
      username: 'alice',
      password: 'secret',
    });

    // Re-read state after state-mutating actions (zustand v4 + resetModules
    // can yield stale snapshots otherwise).
    const state = useAuthStore.getState();

    const stored = localStorage.getItem(TOKENS_KEY);
    expect(stored).toBeTruthy();
    expect(stored).toContain(accessToken);
    expect(JSON.parse(stored ?? '')).toEqual(
      expect.objectContaining({ accessToken, refreshToken, expiresIn }),
    );
    expect(state.tokens?.accessToken).toBe(accessToken);
    expect(state.session?.username).toBe('alice');
    expect(result.needsPasswordChange).toBe(false);
  });

  it('logout clears the stored tokens', async () => {
    vi.doMock('@/services/api/authResource', () => ({
      login: vi.fn().mockResolvedValue({
        success: true,
        data: {
          accessToken: 'a',
          refreshToken: 'r',
          expiresIn: 3600,
        },
      }),
      refresh: vi.fn(),
      changePassword: vi.fn(),
      logout: vi.fn().mockResolvedValue({ success: true }),
    }));

    vi.doMock('@/lib/token', () => ({
      parseJwtPayload: vi.fn().mockReturnValue({
        user_id: 'u_1',
        tenant_id: 'tenant_1',
        username: 'alice',
        role: 'admin',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        jti: 'jti_1',
      }),
    }));

    vi.doMock('@/services/api/client', () => ({
      setSessionAccessor: vi.fn(),
    }));

    const { useAuthStore } = await import('@/store/auth');

    await useAuthStore.getState().login({ username: 'alice', password: 'secret' });
    expect(localStorage.getItem(TOKENS_KEY)).toBeTruthy();

    await useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(localStorage.getItem(TOKENS_KEY)).toBeNull();
    expect(state.tokens).toBeNull();
    expect(state.session).toBeNull();
    expect(state.errorMessage).toBeNull();
  });

  it('login exposes needsPasswordChange=true when JWT has pwd_change_required',
    async () => {
      vi.doMock('@/services/api/authResource', () => ({
        login: vi.fn().mockResolvedValue({
          success: true,
          data: {
            accessToken: 'access.pwdchange',
            refreshToken: 'refresh.value',
            expiresIn: 3600,
          },
        }),
        refresh: vi.fn(),
        changePassword: vi.fn(),
        logout: vi.fn(),
      }));

      vi.doMock('@/lib/token', () => ({
        parseJwtPayload: vi.fn().mockReturnValue({
          user_id: 'u_2',
          tenant_id: 'tenant_1',
          username: 'bob',
          role: 'viewer',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          jti: 'jti_2',
          pwd_change_required: true,
        }),
      }));

      vi.doMock('@/services/api/client', () => ({
        setSessionAccessor: vi.fn(),
      }));

      const { useAuthStore } = await import('@/store/auth');

      const result = await useAuthStore.getState().login({
        username: 'bob',
        password: 'temporary',
      });

      const state = useAuthStore.getState();
      expect(result.needsPasswordChange).toBe(true);
      expect(state.session?.pwd_change_required).toBe(true);
    });
});
