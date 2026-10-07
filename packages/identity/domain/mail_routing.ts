/**
 * @fileoverview E-mail channel routing rules (修订说明书 4.3, 详细设计
 * 6.11.6): Resend (≤ 90 / day, ≤ 2,900 / month). A failed send is refunded
 * only on 429 / 5xx or an exhausted cap; other 4xx are request errors. Codes
 * have priority: other mail yields when fewer than 15 sends are left.
 */

/** Mail priority. */
export type MailPriority = 'otp' | 'normal';

/** Sends a non-OTP message leaves free on each channel. */
export const OTP_RESERVE = 15;

/** Channel names. */
export type ChannelName = 'resend';

/** Caps of a channel. */
export interface ChannelCaps {
  name: ChannelName;
  dailyCap: number;
  monthlyCap?: number;
}

/** Effective cap for a priority (non-OTP mail keeps the reserve free). */
export function effectiveCap(cap: number, priority: MailPriority): number {
  return priority === 'otp' ? cap : Math.max(0, cap - OTP_RESERVE);
}

/** Whether a failed send should fall through to the next channel. */
export function shouldSwitch(status: number): boolean {
  return status === 429 || status >= 500;
}

/** usage_counter keys: the daily key and the monthly key. */
export function channelKeys(
  name: ChannelName,
  now: Date,
): {day: string; key: string; month: string; monthKey: string} {
  const day = now.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  return {
    day,
    key: `email:${name}`,
    month,
    monthKey: `email:${name}:month:${month}`,
  };
}
