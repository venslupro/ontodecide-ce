/**
 * @fileoverview /signup: e-mail + Turnstile → code boxes (paste,
 * one-time-code autofill) → session, time zone saved, cockpit; locale sent;
 * SIGNUP_CLOSED; CODE_INVALID with attempts left; 60 s resend countdown.
 */

import {fireEvent, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';
import {useSession} from '../../entities/session/store';
import {platformDb, recorded, TEST_CODE} from '../../test/handlers/platform';
import {renderWithProviders} from '../../test/render';
import {SignupPage} from './signup_page';

async function toCodeStep(email = 'new.user@example.com') {
  const user = userEvent.setup();
  const r = renderWithProviders(<SignupPage />, {
    as: 'anonymous',
    url: '/signup',
  });
  await user.type(await screen.findByLabelText('邮箱'), email);
  await screen.findByText('人机验证已通过');
  await user.click(screen.getByRole('button', {name: '发送验证码'}));
  return {user, ...r};
}

describe('SignupPage', () => {
  it('signs up with a pasted code, saves the time zone and opens the cockpit', async () => {
    const {router} = await toCodeStep();
    const [send] = recorded('POST', '/auth/codes');
    expect(send.body).toMatchObject({
      email: 'new.user@example.com',
      purpose: 'signup',
      turnstileToken: 'turnstile-test-token',
      locale: 'zh-CN',
    });
    const boxes = await screen.findAllByLabelText(/^第 \d 位$/);
    expect(boxes).toHaveLength(6);
    expect(boxes[0]).toHaveAttribute('autocomplete', 'one-time-code');
    expect(screen.getByText(/\d+ 秒后重新发送/)).toBeInTheDocument();
    fireEvent.paste(boxes[2], {
      clipboardData: {getData: () => ` ${TEST_CODE} `},
    });
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/cockpit'),
    );
    expect(useSession.getState().role).toBe('owner');
    expect(recorded('POST', '/auth/sessions')[0].body).toEqual({
      email: 'new.user@example.com',
      code: TEST_CODE,
      purpose: 'signup',
    });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz !== 'Asia/Shanghai')
      expect(recorded('PATCH', '/me')[0]?.body).toEqual({timeZone: tz});
  });

  it('shows the attempts left for a wrong code', async () => {
    const {user} = await toCodeStep();
    const boxes = await screen.findAllByLabelText(/^第 \d 位$/);
    await user.click(boxes[0]);
    await user.keyboard('000000');
    expect(
      await screen.findByText('验证码不正确，还可尝试 3 次'),
    ).toBeInTheDocument();
    expect(boxes[0]).toHaveAttribute('aria-invalid', 'true');
  });

  it('requires a new code after the attempts are used up', async () => {
    platformDb.codeAttemptsLeft = 1;
    const {user} = await toCodeStep();
    const boxes = await screen.findAllByLabelText(/^第 \d 位$/);
    await user.click(boxes[0]);
    await user.keyboard('999999');
    expect(
      await screen.findByText('错误次数过多，请重新获取验证码'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', {name: '验证并开始试用'})).toBeDisabled();
  });

  it('stays on the e-mail step when sign-ups are closed', async () => {
    platformDb.signupClosed = true;
    await toCodeStep();
    expect(
      await screen.findByText('今日名额已满，请明日再试'),
    ).toBeInTheDocument();
    expect(screen.queryAllByLabelText(/^第 \d 位$/)).toHaveLength(0);
  });
});
