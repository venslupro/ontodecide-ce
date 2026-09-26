/**
 * @fileoverview Client transform chains mirror the server semantics:
 * trim / toNumber / clamp chains, ≤ 5 steps, syntax errors.
 */

import {describe, expect, it} from 'vitest';
import {
  ChainSyntaxError,
  chainSteps,
  compileChain,
  joinSteps,
  TransformError,
  validateChain,
} from './transform';

describe('compileChain', () => {
  it('applies trim|toNumber|clamp(0,100)', () => {
    const c = compileChain('trim|toNumber|clamp(0,100)');
    expect(c.steps).toEqual(['trim', 'toNumber', 'clamp(0,100)']);
    expect(c.apply(' 42 ')).toBe(42);
    expect(c.apply('150')).toBe(100);
    expect(c.apply('-3')).toBe(0);
    expect(c.apply('')).toBeNull();
    expect(c.apply('1,234')).toBe(100);
  });

  it('handles percentages, rounding and defaults', () => {
    expect(compileChain('toNumber').apply('35%')).toBeCloseTo(0.35);
    expect(compileChain('toNumber|round(1)').apply('3.14159')).toBe(3.1);
    expect(compileChain('default(0)|toNumber').apply('')).toBe(0);
    expect(compileChain("default('n/a')").apply(null)).toBe('n/a');
  });

  it('supports lookup, iso3166, split and booleans', () => {
    expect(
      compileChain('lookup(A:active;S:suspended;*:watch)').apply('S'),
    ).toBe('suspended');
    expect(compileChain('lookup(A:active;*:watch)').apply('Z')).toBe('watch');
    expect(compileChain('iso3166').apply('Viet Nam')).toBe('VN');
    expect(compileChain('iso3166').apply('cn')).toBe('CN');
    expect(compileChain("split(';')").apply('M-100; M-101;')).toEqual([
      'M-100',
      'M-101',
    ]);
    expect(compileChain('toBoolean').apply('是')).toBe(true);
    expect(compileChain('trim|upper').apply(' ab ')).toBe('AB');
  });

  it('throws TransformError for bad values', () => {
    expect(() => compileChain('toNumber').apply('abc')).toThrow(TransformError);
    expect(() => compileChain('iso3166').apply('Atlantis')).toThrow(
      TransformError,
    );
    expect(() => compileChain('parseDate').apply('not a date')).toThrow(
      TransformError,
    );
  });

  it('normalizes dates like the server', () => {
    expect(compileChain('parseDate').apply('2026/9/1')).toBe(
      '2026-09-01T00:00:00.000Z',
    );
  });

  it('rejects chains longer than 5 steps', () => {
    const err = validateChain('trim|trim|trim|trim|trim|trim');
    expect(err).toBeInstanceOf(ChainSyntaxError);
    expect(err?.code).toBe('TOO_MANY_STEPS');
    expect(validateChain('trim|trim|trim|trim|trim')).toBeNull();
  });

  it('reports unknown steps and bad arguments', () => {
    expect(validateChain('trim|frobnicate')?.code).toBe('UNKNOWN');
    expect(validateChain('clamp(5)')?.code).toBe('BAD_ARGS');
    expect(validateChain('clamp(10,0)')?.code).toBe('BAD_ARGS');
    expect(validateChain('trim(1)')?.code).toBe('BAD_ARGS');
    expect(validateChain('to-number')?.code).toBe('MALFORMED');
    expect(validateChain('')).toBeNull();
  });

  it('splits and joins steps outside parentheses', () => {
    expect(chainSteps('trim | lookup(a:x;b:y) |clamp(0,1)')).toEqual([
      'trim',
      'lookup(a:x;b:y)',
      'clamp(0,1)',
    ]);
    expect(joinSteps(['trim', ' toNumber ', ''])).toBe('trim|toNumber');
  });
});
