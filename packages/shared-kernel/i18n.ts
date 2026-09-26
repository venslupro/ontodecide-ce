/**
 * @fileoverview Multilingual display text used in ontology schemas.
 */

/** Supported UI locales. */
export const LOCALES = ['zh-CN', 'en-US'] as const;

/** A UI locale. */
export type Locale = (typeof LOCALES)[number];

/** Plain string or a locale → text map. */
export type I18nText = string | Partial<Record<Locale, string>>;

/** Resolves display text, falling back to the other locale then `fallback`. */
export function resolveText(
  text: I18nText | undefined,
  locale: string,
  fallback = '',
): string {
  if (text === undefined) return fallback;
  if (typeof text === 'string') return text;
  const exact = text[locale as Locale];
  if (exact) return exact;
  return text['zh-CN'] ?? text['en-US'] ?? fallback;
}
