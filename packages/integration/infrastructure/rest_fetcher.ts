/**
 * @fileoverview REST pull adapter over an injectable fetch.
 */

import type {RestFetcher, RestResponse} from '../application';

/** Maximum response size accepted from a REST source (5 MB). */
export const REST_MAX_BYTES = 5 * 1024 * 1024;

/** Fetch-based REST client with a timeout. */
export class HttpRestFetcher implements RestFetcher {
  constructor(
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
    private readonly timeoutMs = 20_000,
  ) {}

  async get(
    url: string,
    init: {method: 'GET' | 'POST'; headers: Record<string, string>},
  ): Promise<RestResponse> {
    const res = await this.fetchFn(url, {
      method: init.method,
      headers: init.headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    if (text.length > REST_MAX_BYTES) {
      throw new Error(`Response exceeds ${REST_MAX_BYTES} bytes`);
    }
    let body: unknown = null;
    if (text !== '') {
      try {
        body = JSON.parse(text);
      } catch {
        if (res.ok) throw new Error('Response is not JSON');
      }
    }
    return {status: res.status, body};
  }
}
