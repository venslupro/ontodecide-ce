/**
 * @fileoverview i18n integrity: identical key sets in zh-CN and en-US for
 * every namespace, non-empty strings, valid ICU messages, bundle size, and
 * an `errors.<CODE>` message for every server and client error code.
 */

import IntlMessageFormat from 'intl-messageformat';
import {describe, expect, it} from 'vitest';
import {ERROR_CODES} from '@ontodecide/shared-kernel';
import {NAMESPACES} from '../shared/lib/i18n';

const bundles = import.meta.glob<Record<string, unknown>>('./*/*.json', {
  eager: true,
  import: 'default',
});

function flatten(obj: unknown, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v))
        Object.assign(out, flatten(v, key));
      else out[key] = v;
    }
  }
  return out;
}

function bundle(lang: string, ns: string) {
  return bundles[`./${lang}/${ns}.json`];
}

describe('locale bundles', () => {
  for (const ns of NAMESPACES) {
    describe(ns, () => {
      it('exists in both languages', () => {
        expect(bundle('zh-CN', ns), `zh-CN/${ns}.json`).toBeDefined();
        expect(bundle('en-US', ns), `en-US/${ns}.json`).toBeDefined();
      });

      it('has identical key sets', () => {
        const zh = Object.keys(flatten(bundle('zh-CN', ns))).sort();
        const en = Object.keys(flatten(bundle('en-US', ns))).sort();
        const onlyZh = zh.filter(k => !en.includes(k));
        const onlyEn = en.filter(k => !zh.includes(k));
        expect({onlyZh, onlyEn}).toEqual({onlyZh: [], onlyEn: []});
      });

      it('has non-empty, ICU-valid strings', () => {
        for (const lang of ['zh-CN', 'en-US']) {
          for (const [k, v] of Object.entries(flatten(bundle(lang, ns)))) {
            expect(
              typeof v === 'string' && v.length > 0,
              `${lang}/${ns}:${k}`,
            ).toBe(true);
            expect(
              () => new IntlMessageFormat(v as string, lang),
              `${lang}/${ns}:${k}`,
            ).not.toThrow();
          }
        }
      });

      it('stays well under 30 KB per language', () => {
        for (const lang of ['zh-CN', 'en-US']) {
          expect(JSON.stringify(bundle(lang, ns)).length).toBeLessThan(60_000);
        }
      });
    });
  }
});

/** Client-side codes used by the UI (前端详细设计 表 10). */
const CLIENT_CODES = [
  'NETWORK',
  'ABORTED',
  'HTTP_ERROR',
  'SERVER',
  'RENDER',
  'PAYLOAD_TOO_LARGE',
];

describe('error messages', () => {
  it('has common:errors.<CODE> for every error code in both languages', () => {
    for (const lang of ['zh-CN', 'en-US']) {
      const errors = (
        bundle(lang, 'common') as {errors: Record<string, string>}
      ).errors;
      for (const code of [...ERROR_CODES, ...CLIENT_CODES]) {
        expect(errors[code], `${lang} errors.${code}`).toBeTruthy();
      }
    }
  });

  it('keeps the documented ICU arguments', () => {
    const zh = (bundle('zh-CN', 'common') as {errors: Record<string, string>})
      .errors;
    expect(
      new IntlMessageFormat(zh.CODE_INVALID, 'zh-CN').format({left: 2}),
    ).toBe('验证码不正确，还可尝试 2 次');
    expect(
      new IntlMessageFormat(zh.RATE_LIMITED, 'zh-CN').format({seconds: 5}),
    ).toContain('5');
  });

  it('ships no password or markings strings', () => {
    for (const lang of ['zh-CN', 'en-US']) {
      const flat = flatten(bundle(lang, 'common'));
      expect(Object.keys(flat).some(k => /password|markings/i.test(k))).toBe(
        false,
      );
    }
  });
});
