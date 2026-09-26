/**
 * @fileoverview Webhook signature verification: `X-OD-Timestamp` (unix
 * seconds) within 300 s and `X-OD-Signature` = hex(HMAC-SHA256(secret,
 * `${ts}.${body}`)), compared in constant time.
 */

import {constantTimeEqual, hmacSha256Hex} from '@ontodecide/shared-kernel';
import {INGEST_LIMITS} from '../contract';

/** Header carrying the unix timestamp (seconds). */
export const TIMESTAMP_HEADER = 'x-od-timestamp';
/** Header carrying the hex signature. */
export const SIGNATURE_HEADER = 'x-od-signature';

/** Verification outcome. */
export type SignatureCheck =
  | {ok: true; signature: string; timestamp: number}
  | {ok: false; reason: 'missing' | 'expired' | 'mismatch'};

/** Case-insensitive header lookup. */
export function headerValue(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

/** Computes the signature a sender must attach. */
export function signWebhook(
  secret: string,
  timestamp: number,
  body: string,
): Promise<string> {
  return hmacSha256Hex(secret, `${timestamp}.${body}`);
}

/** Verifies timestamp window and signature. */
export async function verifyWebhookSignature(input: {
  secret: string;
  headers: Record<string, string>;
  body: string;
  now: Date;
  windowSec?: number;
}): Promise<SignatureCheck> {
  const tsRaw = headerValue(input.headers, TIMESTAMP_HEADER)?.trim();
  const sigRaw = headerValue(input.headers, SIGNATURE_HEADER)?.trim();
  if (!tsRaw || !sigRaw || !/^\d{1,12}$/.test(tsRaw)) {
    return {ok: false, reason: 'missing'};
  }
  const timestamp = Number(tsRaw);
  const window = input.windowSec ?? INGEST_LIMITS.webhookWindowSec;
  const nowSec = Math.floor(input.now.getTime() / 1000);
  if (Math.abs(nowSec - timestamp) > window)
    return {ok: false, reason: 'expired'};
  const signature = sigRaw.toLowerCase().replace(/^sha256=/, '');
  const expected = await signWebhook(input.secret, timestamp, input.body);
  if (!constantTimeEqual(signature, expected))
    return {ok: false, reason: 'mismatch'};
  return {ok: true, signature, timestamp};
}
