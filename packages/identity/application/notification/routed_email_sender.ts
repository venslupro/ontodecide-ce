/**
 * @fileoverview RoutedEmailSender (详细设计 6.11.6): tries each channel in
 * order, counting daily (and monthly) sends in usage_counter with atomic
 * conditional updates. A channel is skipped when its cap is used up (non-OTP
 * mail also keeps a 15-send reserve free); a failed send is refunded and the
 * next channel is tried only on 429 / 5xx.
 */

import type {Clock} from '@ontodecide/shared-kernel';
import {
  channelKeys,
  effectiveCap,
  shouldSwitch,
  type ChannelCaps,
  type MailPriority,
} from '../../domain';
import type {
  EmailMessage,
  EmailSender,
  SendResult,
  UsageCounter,
} from '../ports';

/** A provider with its caps. */
export interface Channel {
  caps: ChannelCaps;
  sender: EmailSender;
}

/** Routes messages over an ordered list of channels. */
export class RoutedEmailSender implements EmailSender {
  constructor(
    private readonly channels: readonly Channel[],
    private readonly usage: UsageCounter,
    private readonly clock: Clock,
  ) {}

  private async take(ch: Channel, priority: MailPriority): Promise<boolean> {
    const k = channelKeys(ch.caps.name, this.clock.now());
    const day = await this.usage.tryTake(
      k.day,
      k.key,
      1,
      effectiveCap(ch.caps.dailyCap, priority),
    );
    if (!day) return false;
    if (ch.caps.monthlyCap === undefined) return true;
    const month = await this.usage.tryTake(
      k.month,
      k.monthKey,
      1,
      effectiveCap(ch.caps.monthlyCap, priority),
    );
    if (!month) await this.usage.adjust(k.day, k.key, -1);
    return month;
  }

  private async refund(ch: Channel): Promise<void> {
    const k = channelKeys(ch.caps.name, this.clock.now());
    await this.usage.adjust(k.day, k.key, -1);
    if (ch.caps.monthlyCap !== undefined) {
      await this.usage.adjust(k.month, k.monthKey, -1);
    }
  }

  async send(msg: EmailMessage, idempotencyKey: string): Promise<SendResult> {
    for (const ch of this.channels) {
      if (!(await this.take(ch, msg.priority))) continue;
      let r: SendResult;
      try {
        r = await ch.sender.send(msg, idempotencyKey);
      } catch {
        r = {ok: false, status: 503};
      }
      if (r.ok) return {...r, channel: ch.caps.name};
      await this.refund(ch);
      if (!shouldSwitch(r.status)) return {...r, channel: ch.caps.name};
    }
    return {ok: false, status: 503, deferred: msg.priority !== 'otp'};
  }
}
