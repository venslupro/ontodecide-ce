/**
 * @fileoverview Mail routing (详细设计 表 14 邮件路由): 91st → Brevo, month
 * cap, 429 / 5xx switch, other 4xx no switch, Brevo cap, OTP priority,
 * refunds and idempotency keys.
 */

import {beforeEach, describe, expect, it} from 'vitest';
import {FixedClock} from '@ontodecide/shared-kernel';
import {createTestD1} from '@ontodecide/testing';
import {D1UsageCounter} from '../../infrastructure';
import {FakeEmailSender} from '../../interface/test_fixtures';
import type {EmailMessage} from '../ports';
import {RoutedEmailSender} from './routed_email_sender';

const otp: EmailMessage = {
  to: 'a@example.com',
  subject: '123456',
  html: '',
  text: '',
  template: 'code_login',
  priority: 'otp',
};
const normal: EmailMessage = {
  ...otp,
  template: 'trial_reminder',
  priority: 'normal',
};

describe('RoutedEmailSender', () => {
  let usage: D1UsageCounter;
  let resend: FakeEmailSender;
  let brevo: FakeEmailSender;
  let router: RoutedEmailSender;
  const clock = new FixedClock('2026-09-24T08:00:00Z');

  beforeEach(() => {
    usage = new D1UsageCounter(createTestD1('identity-access'));
    resend = new FakeEmailSender('resend');
    brevo = new FakeEmailSender('brevo');
    router = new RoutedEmailSender(
      [
        {
          caps: {name: 'resend', dailyCap: 90, monthlyCap: 2900},
          sender: resend,
        },
        {caps: {name: 'brevo', dailyCap: 280}, sender: brevo},
      ],
      usage,
      clock,
    );
  });

  it('sends the 91st mail of the day through Brevo', async () => {
    for (let i = 0; i < 91; i++) {
      const r = await router.send(otp, `k${i}`);
      expect(r.ok).toBe(true);
    }
    expect(resend.sent).toHaveLength(90);
    expect(brevo.sent).toHaveLength(1);
    expect(await usage.read('2026-09-24', 'email:resend')).toBe(90);
    expect(await usage.read('2026-09-24', 'email:brevo')).toBe(1);
    expect(await usage.read('2026-09', 'email:resend:month:2026-09')).toBe(90);
  });

  it('switches to Brevo when the monthly Resend cap is used', async () => {
    await usage.set('2026-09', 'email:resend:month:2026-09', 2900);
    const r = await router.send(otp, 'k');
    expect(r.channel).toBe('brevo');
    expect(await usage.read('2026-09-24', 'email:resend')).toBe(0);
  });

  it('switches on 429 and 5xx and refunds the Resend count', async () => {
    resend.script.push(429, 503);
    expect((await router.send(otp, 'a')).channel).toBe('brevo');
    expect((await router.send(otp, 'b')).channel).toBe('brevo');
    expect(await usage.read('2026-09-24', 'email:resend')).toBe(0);
    expect(brevo.sent.map(m => m.key)).toEqual(['a', 'b']);
  });

  it('does not switch on other 4xx', async () => {
    resend.script.push(422);
    const r = await router.send(otp, 'a');
    expect(r).toMatchObject({ok: false, status: 422, channel: 'resend'});
    expect(brevo.calls).toBe(0);
  });

  it('refuses the 281st Brevo mail when Resend is also full', async () => {
    await usage.set('2026-09-24', 'email:resend', 90);
    await usage.set('2026-09-24', 'email:brevo', 280);
    const r = await router.send(otp, 'x');
    expect(r).toMatchObject({ok: false, status: 503, deferred: false});
  });

  it('gives codes priority: other mail yields when < 15 sends are left', async () => {
    await usage.set('2026-09-24', 'email:resend', 76);
    await usage.set('2026-09-24', 'email:brevo', 266);
    const r = await router.send(normal, 'reminder');
    expect(r).toMatchObject({ok: false, deferred: true});
    expect((await router.send(otp, 'code')).channel).toBe('resend');
  });

  it('passes the same idempotency key on retries', async () => {
    resend.script.push(500);
    brevo.script.push(500);
    expect((await router.send(normal, 'archive:t1')).ok).toBe(false);
    expect((await router.send(normal, 'archive:t1')).ok).toBe(true);
    expect((await router.send(normal, 'archive:t1')).ok).toBe(true);
    // Provider-side idempotency: one delivered message for the key.
    expect(resend.sent.filter(m => m.key === 'archive:t1')).toHaveLength(1);
  });
});
