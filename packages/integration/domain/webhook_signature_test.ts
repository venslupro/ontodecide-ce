/**
 * @fileoverview Tests for webhook signature verification.
 */

import {describe, expect, it} from 'vitest';
import {signWebhook, verifyWebhookSignature} from './webhook_signature';

const secret = 's3cret';
const body = '{"supplierId":"S-1"}';
const now = new Date('2026-09-24T00:00:00Z');
const ts = Math.floor(now.getTime() / 1000);

describe('verifyWebhookSignature', () => {
  it('accepts a valid signature (headers case-insensitive)', async () => {
    const sig = await signWebhook(secret, ts, body);
    const r = await verifyWebhookSignature({
      secret,
      body,
      now,
      headers: {'X-OD-Timestamp': String(ts), 'X-OD-Signature': sig},
    });
    expect(r).toEqual({ok: true, signature: sig, timestamp: ts});
  });

  it('rejects a wrong signature or tampered body', async () => {
    const sig = await signWebhook('other', ts, body);
    const r = await verifyWebhookSignature({
      secret,
      body,
      now,
      headers: {'x-od-timestamp': String(ts), 'x-od-signature': sig},
    });
    expect(r).toEqual({ok: false, reason: 'mismatch'});
    const good = await signWebhook(secret, ts, body);
    const tampered = await verifyWebhookSignature({
      secret,
      body: body + ' ',
      now,
      headers: {'x-od-timestamp': String(ts), 'x-od-signature': good},
    });
    expect(tampered.ok).toBe(false);
  });

  it('rejects timestamps outside the 300 s window', async () => {
    const old = ts - 301;
    const sig = await signWebhook(secret, old, body);
    const r = await verifyWebhookSignature({
      secret,
      body,
      now,
      headers: {'x-od-timestamp': String(old), 'x-od-signature': sig},
    });
    expect(r).toEqual({ok: false, reason: 'expired'});
    const edge = ts - 300;
    const ok = await verifyWebhookSignature({
      secret,
      body,
      now,
      headers: {
        'x-od-timestamp': String(edge),
        'x-od-signature': await signWebhook(secret, edge, body),
      },
    });
    expect(ok.ok).toBe(true);
  });

  it('rejects missing headers', async () => {
    const r = await verifyWebhookSignature({secret, body, now, headers: {}});
    expect(r).toEqual({ok: false, reason: 'missing'});
  });
});
