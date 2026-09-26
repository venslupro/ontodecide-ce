/**
 * @fileoverview Writeback over HTTPS webhooks: JSON POST signed with
 * X-OD-Timestamp / X-OD-Signature = hex(HMAC-SHA256(secret,
 * `${timestamp}.${body}`)) and an Idempotency-Key of the action log id.
 */

import {AppError, hmacSha256Hex, systemClock} from '@ontodecide/shared-kernel';
import type {Clock} from '@ontodecide/shared-kernel';
import type {WritebackPort} from '../application/ports';

/** Webhook writeback client (injectable fetch). */
export class WebhookWriteback implements WritebackPort {
  constructor(
    private readonly secret: string | undefined,
    private readonly fetchFn: typeof fetch,
    private readonly clock: Clock = systemClock,
    private readonly timeoutMs = 5000,
  ) {}

  async send(req: {
    url: string;
    body: unknown;
    idempotencyKey: string;
  }): Promise<void> {
    const raw = JSON.stringify(req.body);
    const ts = String(Math.floor(this.clock.now().getTime() / 1000));
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'idempotency-key': req.idempotencyKey,
      'x-od-timestamp': ts,
    };
    if (this.secret) {
      headers['x-od-signature'] = await hmacSha256Hex(
        this.secret,
        `${ts}.${raw}`,
      );
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(req.url, {
        method: 'POST',
        headers,
        body: raw,
        signal: ctrl.signal,
      });
      if (!res.ok) {
        throw new AppError(
          'UPSTREAM_FAILED',
          `Writeback returned ${res.status}`,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
