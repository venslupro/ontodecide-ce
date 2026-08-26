/**
 * Render tests for AuthGuard and AdminGuard.
 *
 * The tests prime the auth store via the persisted localStorage token and
 * mock `parseJwtPayload` to return sessions with the desired roles so the
 * guards behave deterministically under test.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const TOKENS_KEY = 'ontodecide.tokens';

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  localStorage.clear();
});

/** Guard types as imported dynamically inside renderGuarded. */
type GuardComp = (props: { children?: React.ReactNode }) => JSX.Element;

/**
 * Render a guard component wrapped in a MemoryRouter that starts at
 * `/dashboard` and exposes `/login` and `/401` sentinel routes we can use
 * to detect redirects.
 *
 * @param buildUi Factory that receives freshly-mocked guard components and
 *   returns the React tree to render under `/dashboard`.
 * @param session Session payload returned by the mocked parseJwtPayload.
 */
async function renderGuarded(
  buildUi: (comps: {
    AuthGuard: GuardComp;
    AdminGuard: GuardComp;
    AnonymousOnly: GuardComp;
  }) => React.ReactNode,
  session: unknown | null,
) {
  vi.doMock('@/lib/token', () => ({
    parseJwtPayload: vi.fn().mockReturnValue(session),
  }));
  vi.doMock('@/services/api/client', () => ({
    setSessionAccessor: vi.fn(),
  }));
  vi.doMock('@/services/api/authResource', () => ({
    login: vi.fn(),
    refresh: vi.fn(),
    changePassword: vi.fn(),
    logout: vi.fn(),
  }));

  const AuthGuardMod = await import('@/components/shared/AuthGuard');
  const AdminGuardMod = await import('@/components/shared/AdminGuard');
  const AnonymousOnlyMod = await import('@/components/shared/AnonymousOnly');

  const AuthGuard = AuthGuardMod.AuthGuard as GuardComp;
  const AdminGuard = AdminGuardMod.AdminGuard as GuardComp;
  const AnonymousOnly = AnonymousOnlyMod.AnonymousOnly as GuardComp;

  const ui = buildUi({ AuthGuard, AdminGuard, AnonymousOnly });

  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/login" element={<div data-testid="login-route">login</div>} />
        <Route path="/401" element={<div data-testid="unauthorized-route">unauthorized</div>} />
        <Route path="/dashboard" element={ui} />
        <Route
          path="/anonymous"
          element={<AnonymousOnly>{ui}</AnonymousOnly>}
        />
      </Routes>
    </MemoryRouter>,
  );

  return { AuthGuard, AdminGuard, AnonymousOnly };
}

describe('AuthGuard', () => {
  it('redirects anonymous users to /login', async () => {
    localStorage.removeItem(TOKENS_KEY);
    await renderGuarded(
      ({ AuthGuard }) => (
        <AuthGuard>
          <div>dashboard content</div>
        </AuthGuard>
      ),
      null,
    );

    expect(screen.getByTestId('login-route')).toBeInTheDocument();
    expect(screen.queryByText('dashboard content')).not.toBeInTheDocument();
  });
});

describe('AdminGuard', () => {
  it('redirects non-admin users to /401', async () => {
    const userSession = {
      user_id: 'u_1',
      tenant_id: 'tenant_1',
      username: 'eve',
      role: 'user',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      jti: 'jti_user',
    };
    localStorage.setItem(
      TOKENS_KEY,
      JSON.stringify({ accessToken: 'fakeJwt', refreshToken: 'x' }),
    );

    await renderGuarded(
      ({ AdminGuard }) => (
        <AdminGuard>
          <div>admin content</div>
        </AdminGuard>
      ),
      userSession,
    );

    expect(screen.getByTestId('unauthorized-route')).toBeInTheDocument();
    expect(screen.queryByText('admin content')).not.toBeInTheDocument();
  });

  it('renders children for admin users', async () => {
    const adminSession = {
      user_id: 'u_1',
      tenant_id: 'tenant_1',
      username: 'admin',
      role: 'admin',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      jti: 'jti_admin',
    };
    localStorage.setItem(
      TOKENS_KEY,
      JSON.stringify({ accessToken: 'fakeJwt', refreshToken: 'x' }),
    );

    await renderGuarded(
      ({ AdminGuard }) => (
        <AdminGuard>
          <div>admin content</div>
        </AdminGuard>
      ),
      adminSession,
    );

    expect(screen.getByText('admin content')).toBeVisible();
    expect(screen.queryByTestId('unauthorized-route')).not.toBeInTheDocument();
  });
});
