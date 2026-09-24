/**
 * @fileoverview Intl formatters in both UI locales.
 */

import {describe, expect, it} from 'vitest';
import {createFormatters, fmt, setFormatLocale} from './format';

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
