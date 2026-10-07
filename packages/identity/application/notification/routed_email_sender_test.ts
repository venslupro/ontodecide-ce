/**
 * @fileoverview Mail routing (详细设计 表 14 邮件路由): daily and monthly
 * caps, 429 / 5xx refund, other 4xx no switch, OTP priority, refunds and
 * idempotency keys.
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
  let router: RoutedEmailSender;
  const clock = new FixedClock('2026-09-24T08:00:00Z');

  beforeEach(() => {
    usage = new D1UsageCounter(createTestD1('identity-access'));
    resend = new FakeEmailSender('resend');
    router = new RoutedEmailSender(
      [
        {
          caps: {name: 'resend', dailyCap: 90, monthlyCap: 2900},
          sender: resend,
        },
      ],
      usage,
      clock,
    );
  });

  it('defers the 91st mail of the day when the daily cap is used', async () => {
    for (let i = 0; i < 90; i++) {
      const r = await router.send(otp, `k${i}`);
      expect(r.ok).toBe(true);
    }
    const r = await router.send(otp, 'k90');
    expect(r).toMatchObject({ok: false, status: 503, deferred: false});
    expect(resend.sent).toHaveLength(90);
    expect(await usage.read('2026-09-24', 'email:resend')).toBe(90);
    expect(await usage.read('2026-09', 'email:resend:month:2026-09')).toBe(90);
  });

  it('refuses when the monthly Resend cap is used', async () => {
    await usage.set('2026-09', 'email:resend:month:2026-09', 2900);
    const r = await router.send(otp, 'k');
    expect(r).toMatchObject({ok: false, status: 503});
    expect(await usage.read('2026-09-24', 'email:resend')).toBe(0);
  });

  it('refunds the Resend count on 429 and 5xx', async () => {
    resend.script.push(429, 503);
    // No fallback channel: a switchable error surfaces as 503.
    expect(await router.send(otp, 'a')).toMatchObject({
      ok: false,
      status: 503,
      deferred: false,
    });
    expect(await router.send(otp, 'b')).toMatchObject({
      ok: false,
      status: 503,
      deferred: false,
    });
    expect(await usage.read('2026-09-24', 'email:resend')).toBe(0);
  });

  it('does not switch on other 4xx', async () => {
    resend.script.push(422);
    const r = await router.send(otp, 'a');
    expect(r).toMatchObject({ok: false, status: 422, channel: 'resend'});
  });

  it('gives codes priority: other mail yields when < 15 sends are left', async () => {
    await usage.set('2026-09-24', 'email:resend', 76);
    const r = await router.send(normal, 'reminder');
    expect(r).toMatchObject({ok: false, deferred: true});
    expect((await router.send(otp, 'code')).channel).toBe('resend');
  });

  it('passes the same idempotency key on retries', async () => {
    resend.script.push(500);
    expect((await router.send(normal, 'archive:t1')).ok).toBe(false);
    expect((await router.send(normal, 'archive:t1')).ok).toBe(true);
    expect((await router.send(normal, 'archive:t1')).ok).toBe(true);
    // Provider-side idempotency: one delivered message for the key.
    expect(resend.sent.filter(m => m.key === 'archive:t1')).toHaveLength(1);
  });
});
