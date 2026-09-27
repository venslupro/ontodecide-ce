/**
 * @fileoverview Intl formatters in both UI locales.
 */

import {describe, expect, it} from 'vitest';
import {createFormatters, fmt, setFormatLocale, shortTid} from './format';

const zh = createFormatters('zh-CN');
const en = createFormatters('en-US');
const norm = (s: string) => s.replace(/\u00a0|\u202f/g, ' ');

describe('formatters', () => {
  it('formats numbers', () => {
    expect(zh.number(12345.6)).toBe('12,345.6');
    expect(en.number(12345.6)).toBe('12,345.6');
    expect(zh.number(null)).toBe('—');
    expect(en.number(Number.NaN)).toBe('—');
  });

  it('formats compact numbers', () => {
    expect(zh.compact(128000)).toBe('12.8万');
    expect(en.compact(128000)).toBe('128K');
  });

  it('formats dates', () => {
    const ts = '2026-09-24T08:00:00Z';
    expect(zh.date(ts)).toBe('2026年9月24日');
    expect(en.date(ts)).toBe('Sep 24, 2026');
    expect(zh.date('not a date')).toBe('—');
  });

  it('formats relative time', () => {
    expect(zh.relative(-2, 'minute')).toBe('2分钟前');
    expect(en.relative(-2, 'minute')).toBe('2 minutes ago');
    const now = Date.parse('2026-09-24T08:00:00Z');
    expect(en.ago('2026-09-24T07:58:00Z', now)).toBe('2 minutes ago');
    expect(zh.ago('2026-09-24T05:00:00Z', now)).toBe('3小时前');
    expect(en.ago('2026-09-22T08:00:00Z', now)).toBe('2 days ago');
  });

  it('formats currency', () => {
    expect(norm(zh.currency(4800, 'CNY'))).toBe('¥4,800');
    expect(norm(en.currency(4800, 'CNY'))).toBe('CN¥4,800');
  });

  it('formats percentages with sign', () => {
    expect(en.percent(0.83)).toBe('83%');
    expect(en.signedPercent(0.22)).toBe('+22%');
    expect(zh.signedPercent(-0.125)).toBe('-12.5%');
    expect(en.signedPercent(0)).toBe('0%');
  });

  it('follows the active locale through fmt', () => {
    setFormatLocale('en-US');
    expect(fmt.compact(128000)).toBe('128K');
    setFormatLocale('zh-CN');
    expect(fmt.compact(128000)).toBe('12.8万');
  });
});

describe('CE formatters', () => {
  it('formats the remaining trial time', () => {
    const H = 3_600_000;
    expect(zh.remaining(29 * H)).toBe('1 天 05 小时');
    expect(en.remaining(29 * H)).toBe('1d 05h');
    expect(zh.remaining(5 * H + 3 * 60_000)).toBe('5 小时 03 分');
    expect(en.remaining(59 * 60_000 + 12_000)).toBe('59m 12s');
    expect(en.remaining(-5)).toBe('00m 00s');
  });

  it('formats times in the account time zone', () => {
    const t = '2026-09-30T06:20:00Z';
    expect(zh.dateTimeTz(t, 'Asia/Shanghai')).toBe('2026-09-30 14:20');
    expect(norm(en.dateTimeTz(t, 'Asia/Shanghai'))).toBe(
      'Sep 30, 2026, 2:20 PM',
    );
    expect(zh.shortDateTime(t, 'Asia/Shanghai')).toBe('09-30 14:20');
    expect(en.tzName(t, 'Asia/Shanghai')).toBe('GMT+8');
    expect(zh.dateTimeTz(t, 'Not/AZone')).toMatch(/^2026-09-30 \d\d:20$/);
  });

  it('formats bytes and short workspace ids', () => {
    expect(zh.bytes(212_000)).toBe('212 KB');
    expect(en.bytes(1_400_000)).toBe('1.4 MB');
    expect(shortTid('ws-01J8ZABCDEFGHK4')).toBe('ws-01J8Z…K4');
  });
});
