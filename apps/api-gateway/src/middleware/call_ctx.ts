/**
 * @fileoverview Builds the CallCtx forwarded to every service.
 */

import type {CallCtx, Locale} from '@ontodecide/shared-kernel';
import type {Middleware} from './chain';

/**
 * Picks the first supported locale from an Accept-Language header
 * (`zh*` → zh-CN, `en*` → en-US), honoring q-values.
 */
export function pickLocale(header: string | null): Locale | undefined {
  if (!header) return undefined;
  const tags = header
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map(p => p.trim()).find(p => p.startsWith('q='));
      return {tag: tag.trim().toLowerCase(), q: q ? Number(q.slice(2)) : 1, i};
    })
    .filter(t => t.tag && !Number.isNaN(t.q) && t.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const {tag} of tags) {
    if (tag === 'zh' || tag.startsWith('zh-')) return 'zh-CN';
    if (tag === 'en' || tag.startsWith('en-')) return 'en-US';
  }
  return undefined;
}

/** CallCtx step (anonymous context for public / cookie / hmac routes). */
export function callCtx(): Middleware {
  return async (s, next) => {
    const locale =
      pickLocale(s.request.headers.get('accept-language')) ??
      (s.claims?.locale as Locale | undefined);
    const ctx: CallCtx = s.claims
      ? {
          tenantId: s.claims.tid,
          userId: s.claims.sub,
          roles: [s.claims.role],
          markings: Array.isArray(s.claims.mk) ? s.claims.mk : [],
          requestId: s.requestId,
          correlationId: s.correlationId,
        }
      : {
          tenantId: '',
          userId: 'anonymous',
          roles: [],
          markings: [],
          requestId: s.requestId,
          correlationId: s.correlationId,
        };
    if (locale) ctx.locale = locale;
    s.ctx = ctx;
    return next();
  };
}
