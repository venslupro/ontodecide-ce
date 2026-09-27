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
  /** Remaining duration: `1 天 05 小时` / `1d 05h` (≤ 1 h: minutes, seconds). */
  remaining(ms: number): string;
  /** Date + time in a time zone: `2026-09-30 14:20` / `Sep 30, 2026, 2:20 PM`. */
  dateTimeTz(
    v: string | number | Date | null | undefined,
    timeZone?: string,
  ): string;
  /** Compact `09-30 14:20` in a time zone (timelines, tables). */
  shortDateTime(
    v: string | number | Date | null | undefined,
    timeZone?: string,
  ): string;
  /** Short time-zone name for a moment, e.g. `GMT+8`. */
  tzName(v: string | number | Date, timeZone?: string): string;
  /** Byte size: `212 KB`, `1.4 MB`. */
  bytes(n: number | null | undefined): string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function safeTz(timeZone: string | undefined): string | undefined {
  if (!timeZone) return undefined;
  try {
    new Intl.DateTimeFormat('en-US', {timeZone});
    return timeZone;
  } catch {
    return undefined;
  }
}

function partsOf(
  d: Date,
  timeZone: string | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone: safeTz(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)) {
    out[p.type] = p.value;
  }
  return out;
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
  const f = {
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
  } as Formatters;
  const zh = locale.toLowerCase().startsWith('zh');
  f.remaining = ms => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(total / 86_400);
    const h = Math.floor((total % 86_400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (d > 0) return zh ? `${d} 天 ${pad2(h)} 小时` : `${d}d ${pad2(h)}h`;
    if (h > 0) return zh ? `${h} 小时 ${pad2(m)} 分` : `${h}h ${pad2(m)}m`;
    return zh ? `${pad2(m)} 分 ${pad2(s)} 秒` : `${pad2(m)}m ${pad2(s)}s`;
  };
  f.dateTimeTz = (v, timeZone) => {
    if (v === null || v === undefined) return DASH;
    const d = toDate(v);
    if (!valid(d)) return DASH;
    if (zh) {
      const p = partsOf(d, timeZone);
      return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
    }
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: safeTz(timeZone),
    }).format(d);
  };
  f.shortDateTime = (v, timeZone) => {
    if (v === null || v === undefined) return DASH;
    const d = toDate(v);
    if (!valid(d)) return DASH;
    const p = partsOf(d, timeZone);
    return `${p.month}-${p.day} ${p.hour}:${p.minute}`;
  };
  f.tzName = (v, timeZone) => {
    const d = toDate(v);
    if (!valid(d)) return '';
    const part = new Intl.DateTimeFormat(locale, {
      timeZone: safeTz(timeZone),
      timeZoneName: 'short',
    })
      .formatToParts(d)
      .find(p => p.type === 'timeZoneName');
    return part?.value ?? '';
  };
  f.bytes = n => {
    if (n === null || n === undefined || !Number.isFinite(n)) return DASH;
    if (n < 1000) return `${Math.round(n)} B`;
    if (n < 1_000_000) return `${Math.round(n / 1000)} KB`;
    return `${new Intl.NumberFormat(locale, {maximumFractionDigits: 1}).format(n / 1_000_000)} MB`;
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

/** Shortens a workspace id for display: `ws-01J8Z…K4`. */
export function shortTid(tid: string): string {
  const id = tid.replace(/^ws-/, '');
  return id.length > 9 ? `ws-${id.slice(0, 5)}…${id.slice(-2)}` : `ws-${id}`;
}
