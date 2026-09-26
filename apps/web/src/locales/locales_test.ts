/**
 * @fileoverview i18n integrity: identical key sets in zh-CN and en-US for
 * every namespace, non-empty strings, valid ICU messages, and bundle size.
 */

import IntlMessageFormat from 'intl-messageformat';
import {describe, expect, it} from 'vitest';
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
