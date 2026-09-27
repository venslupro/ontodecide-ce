/**
 * @fileoverview Admin passkey gate: a recovery-code session binds a new
 * passkey (no step-up) before anything else; fewer than 2 passkeys
 * re-enters the setup (step-up + bind); a 403 RECOVERY_PENDING from any
 * request forces the gate; recovery codes returned are shown once.
 */

import {screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, describe, expect, it} from 'vitest';
import {adminSetupNeeded, useSession} from '../../entities/session/store';
import {adminMe} from '../../test/fixtures/platform';
import {platformDb, recorded} from '../../test/handlers/platform';
import {renderApp} from '../../test/render';
import {installWebAuthn, removeWebAuthn} from '../../test/webauthn_mock';

afterEach(() => removeWebAuthn());

async function saveCodesAndContinue(user: ReturnType<typeof userEvent.setup>) {
  expect(await screen.findAllByText(/^RC-\d{4}-ABCD$/)).toHaveLength(10);
  await user.click(screen.getByLabelText('我已保存这些恢复码'));
  await user.click(screen.getByRole('button', {name: '进入平台管理'}));
}

describe('adminSetupNeeded', () => {
  it('derives the gate from /me and the 403 flag', () => {
    const me = adminMe();
    expect(adminSetupNeeded({role: 'admin', me})).toBeNull();
    expect(
      adminSetupNeeded({role: 'admin', me: {...me, recoveryPending: true}}),
    ).toBe('recovery');
    expect(adminSetupNeeded({role: 'admin', me: adminMe(1)})).toBe('setup');
    expect(
      adminSetupNeeded({role: 'admin', me: {...me, recoveryCodesLeft: 0}}),
    ).toBe('setup');
    expect(adminSetupNeeded({role: 'admin', me, adminGate: 'recovery'})).toBe(
      'recovery',
    );
    expect(adminSetupNeeded({role: 'owner', me: adminMe(1)})).toBeNull();
  });
});

describe('AdminSetupGate', () => {
  it('recovery session: binds a new passkey without step-up before anything else', async () => {
    const {create, get} = installWebAuthn();
    platformDb.recoveryPending = true;
    const user = userEvent.setup();
    renderApp('/admin', {
      as: 'admin',
      me: {...adminMe(), recoveryPending: true},
    });
    expect(
      await screen.findByRole('heading', {name: '绑定 Passkey'}),
    ).toBeInTheDocument();
    expect(screen.getByText(/你使用恢复码登录/)).toBeInTheDocument();
    // Nothing else of the app is shown or requested.
    expect(screen.queryByRole('navigation', {name: '主导航'})).toBeNull();
    expect(recorded('GET', '/admin/overview')).toHaveLength(0);
    await user.click(screen.getByRole('button', {name: '绑定新的 Passkey'}));
    await saveCodesAndContinue(user);
    expect(create).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
    const [add] = recorded('POST', '/admin/passkeys').filter(
      r => r.path === '/admin/passkeys',
    );
    expect(add.headers['x-step-up']).toBeUndefined();
    expect(
      await screen.findByRole('heading', {name: '平台概览'}),
    ).toBeInTheDocument();
    expect(useSession.getState().me?.recoveryPending).toBeFalsy();
    // The upgraded session row (otp + passkey) is picked up by a refresh.
    expect(recorded('POST', '/auth/sessions/refresh').length).toBeGreaterThan(
      0,
    );
  });

  it('re-enters the first-login flow with fewer than 2 passkeys (step-up first)', async () => {
    const {create, get} = installWebAuthn();
    platformDb.adminPasskeys = 1;
    const user = userEvent.setup();
    renderApp('/admin', {as: 'admin', me: adminMe(1)});
    await user.click(
      await screen.findByRole('button', {name: '绑定新的 Passkey'}),
    );
    await saveCodesAndContinue(user);
    expect(get).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    const [add] = recorded('POST', '/admin/passkeys').filter(
      r => r.path === '/admin/passkeys',
    );
    expect(add.headers['x-step-up']).toBe('su-1');
    expect(
      await screen.findByRole('heading', {name: '平台概览'}),
    ).toBeInTheDocument();
  });

  it('a 403 RECOVERY_PENDING from any request forces the gate', async () => {
    installWebAuthn();
    platformDb.recoveryPending = true;
    renderApp('/admin', {as: 'admin', me: adminMe()});
    expect(
      await screen.findByRole('heading', {name: '绑定 Passkey'}),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(useSession.getState().adminGate).toBe('recovery'),
    );
  });
});
