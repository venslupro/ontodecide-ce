/**
 * @fileoverview Cloudflare Turnstile siteverify adapter. With Cloudflare's
 * published test secret (`1x0000000000000000000000000000000AA`) every token
 * passes, which is what local development uses.
 */

import type {TurnstileVerifier} from '../application';

/** siteverify endpoint. */
export const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Cloudflare's always-passing test secret. */
export const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';

/** Verifies tokens with siteverify. */
export class HttpTurnstileVerifier implements TurnstileVerifier {
  constructor(
    private readonly secret: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async verify(token: string, ip: string): Promise<boolean> {
    if (!this.secret) return false;
    const body = new URLSearchParams({secret: this.secret, response: token});
    if (ip) body.set('remoteip', ip);
    try {
      const res = await this.fetchFn(TURNSTILE_VERIFY_URL, {
        method: 'POST',
        body,
      });
      if (!res.ok) return false;
      const data = (await res.json()) as {success?: boolean};
      return data.success === true;
    } catch {
      return false;
    }
  }
}
