/**
 * @fileoverview Locale-aware formatters built on Intl (前端详细设计 §国际化).
 * Formatter instances are cached per locale; `fmt` follows the active i18n
 * language, `createFormatters(locale)` is explicit (and used in tests).
 */

type RelUnit = Intl.RelativeTimeFormatUnit;

/** A set of formatters bound to one locale. */
export interface Formatters {
  locale: string;
  number(v: number | null | undefined, opts?: Intl.NumberFormatOptions): string;
  compact(v: number | null | undefined): string;
  percent(v: number | null | undefined, digits?: number): string;
  signedPercent(v: number | null | undefined, digits?: number): string;
  date(v: string | number | Date | null | undefined): string;
  dateTime(v: string | number | Date | null | undefined): string;
  time(v: string | number | Date | null | undefined): string;
  relative(value: number, unit: RelUnit): string;
  /** Relative time from now for a timestamp, choosing the unit. */
  ago(v: string | number | Date | null | undefined, now?: number): string;
  currency(v: number | null | undefined, currency?: string): string;
}

const DASH = '—';
const cache = new Map<string, Formatters>();

function toDate(v: string | number | Date): Date {
  return v instanceof Date ? v : new Date(v);
}

function valid(d: Date): boolean {
  return !Number.isNaN(d.getTime());
}

/** Builds (or returns cached) formatters for a locale. */
export function createFormatters(locale: string): Formatters {
  const hit = cache.get(locale);
  if (hit) return hit;
  const numFmt = new Intl.NumberFormat(locale, {maximumFractionDigits: 2});
  const compactFmt = new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  });
  const dateFmt = new Intl.DateTimeFormat(locale, {dateStyle: 'medium'});
  const dateTimeFmt = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const timeFmt = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  });
  const relFmt = new Intl.RelativeTimeFormat(locale, {numeric: 'auto'});
  const f: Formatters = {
    locale,
    number(v, opts) {
      if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
      return opts
        ? new Intl.NumberFormat(locale, opts).format(v)
        : numFmt.format(v);
    },
    compact(v) {
      if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
      return compactFmt.format(v);
    },
    percent(v, digits = 0) {
      if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
      return new Intl.NumberFormat(locale, {
        style: 'percent',
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      }).format(v);
    },
    signedPercent(v, digits = 1) {
      if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
      return new Intl.NumberFormat(locale, {
        style: 'percent',
        maximumFractionDigits: digits,
        signDisplay: 'exceptZero',
      }).format(v);
    },
    date(v) {
      if (v === null || v === undefined) return DASH;
      const d = toDate(v);
      return valid(d) ? dateFmt.format(d) : DASH;
    },
    dateTime(v) {
      if (v === null || v === undefined) return DASH;
      const d = toDate(v);
      return valid(d) ? dateTimeFmt.format(d) : DASH;
    },
    time(v) {
      if (v === null || v === undefined) return DASH;
      const d = toDate(v);
      return valid(d) ? timeFmt.format(d) : DASH;
    },
    relative(value, unit) {
      return relFmt.format(value, unit);
    },
    ago(v, now = Date.now()) {
      if (v === null || v === undefined) return DASH;
      const d = toDate(v);
      if (!valid(d)) return DASH;
      const sec = Math.round((d.getTime() - now) / 1000);
      const abs = Math.abs(sec);
      if (abs < 45) return relFmt.format(sec, 'second');
      if (abs < 2700) return relFmt.format(Math.round(sec / 60), 'minute');
      if (abs < 79_200) return relFmt.format(Math.round(sec / 3600), 'hour');
      if (abs < 2_592_000)
        return relFmt.format(Math.round(sec / 86_400), 'day');
      return dateFmt.format(d);
    },
    currency(v, currency = 'CNY') {
      if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        maximumFractionDigits: 2,
        minimumFractionDigits: 0,
      }).format(v);
    },
  };
  cache.set(locale, f);
  return f;
}

let activeLocale = 'zh-CN';

/** Sets the locale used by {@link fmt} (called on language change). */
export function setFormatLocale(locale: string): void {
  activeLocale = locale;
}

/** Formatters for the active UI language. */
export const fmt: Formatters = new Proxy({} as Formatters, {
  get(_t, prop: keyof Formatters) {
    return createFormatters(activeLocale)[prop];
  },
});
