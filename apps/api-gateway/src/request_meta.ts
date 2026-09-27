/**
 * @fileoverview Request metadata forwarded to identity-access
 * ({@link RequestMeta}: IP and a short client label) and the locale taken
 * from Accept-Language (affects e-mails and server-generated text only).
 */

import type {RequestMeta} from '@ontodecide/identity/contract';
import type {Locale} from '@ontodecide/shared-kernel';

/** Default locale when Accept-Language names neither zh nor en. */
export const DEFAULT_LOCALE: Locale = 'zh-CN';

/** Client IP (CF-Connecting-IP; `unknown` outside Cloudflare). */
export function clientIp(headers: Headers): string {
  return headers.get('cf-connecting-ip')?.trim() || 'unknown';
}

const BROWSERS: [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/OPR\//, 'Opera'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

/** Short client label from a User-Agent, e.g. `Chrome · macOS`. */
export function clientLabel(ua: string | null): string | undefined {
  if (!ua) return undefined;
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1];
  const os = SYSTEMS.find(([re]) => re.test(ua))?.[1];
  const parts = [browser, os].filter((p): p is string => !!p);
  return parts.length ? parts.join(' · ') : 'Other';
}

/** RequestMeta of a request. */
export function requestMeta(headers: Headers): RequestMeta {
  const client = clientLabel(headers.get('user-agent'));
  return {ip: clientIp(headers), ...(client ? {client} : {})};
}

/** First supported locale of an Accept-Language header (q-ordered). */
export function localeOf(header: string | null): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params
        .map(p => /^\s*q=([0-9.]+)\s*$/.exec(p)?.[1])
        .find(v => v !== undefined);
      return {tag: tag.trim().toLowerCase(), q: q ? Number(q) : 1, i};
    })
    .filter(x => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const {tag} of ranked) {
    if (tag.startsWith('zh')) return 'zh-CN';
    if (tag.startsWith('en')) return 'en-US';
  }
  return DEFAULT_LOCALE;
}
