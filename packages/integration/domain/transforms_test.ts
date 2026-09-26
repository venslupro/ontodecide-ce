/**
 * @fileoverview Tests for transforms and the chain parser.
 */

import {AppError} from '@ontodecide/shared-kernel';
import {describe, expect, it} from 'vitest';
import {
  compileChain,
  registerTransform,
  transformNames,
  TransformError,
} from './transforms';

const run = (expr: string, v: unknown) => compileChain(expr).apply(v);

describe('transforms', () => {
  it('trim / lower / upper', () => {
    expect(run('trim', '  a b ')).toBe('a b');
    expect(run('trim', 5)).toBe(5);
    expect(run('lower', 'AbC')).toBe('abc');
    expect(run('upper', 'AbC')).toBe('ABC');
    expect(run('lower', null)).toBeNull();
  });

  it('toNumber / toInteger', () => {
    expect(run('toNumber', '1,234.5')).toBe(1234.5);
    expect(run('toNumber', ' 42 ')).toBe(42);
    expect(run('toNumber', '50%')).toBe(0.5);
    expect(run('toNumber', '')).toBeNull();
    expect(run('toNumber', 7)).toBe(7);
    expect(() => run('toNumber', 'abc')).toThrow(TransformError);
    expect(run('toInteger', '12.9')).toBe(12);
    expect(run('toInteger', '-3.2')).toBe(-3);
  });

  it('toBoolean', () => {
    expect(run('toBoolean', 'Yes')).toBe(true);
    expect(run('toBoolean', '0')).toBe(false);
    expect(run('toBoolean', true)).toBe(true);
    expect(run('toBoolean', '')).toBeNull();
    expect(() => run('toBoolean', 'maybe')).toThrow(TransformError);
  });

  it('parseDate', () => {
    expect(run('parseDate', '2026-09-01')).toBe('2026-09-01T00:00:00.000Z');
    expect(run('parseDate', '2026/9/1')).toBe('2026-09-01T00:00:00.000Z');
    expect(run('parseDate', 1_790_000_000)).toBe(
      new Date(1_790_000_000_000).toISOString(),
    );
    expect(() => run('parseDate', 'not a date')).toThrow(TransformError);
  });

  it('clamp / round', () => {
    expect(run('clamp(0,100)', 120)).toBe(100);
    expect(run('clamp(0,100)', '-5')).toBe(0);
    expect(run('clamp(0, 100)', 50)).toBe(50);
    expect(run('round(2)', 3.14159)).toBe(3.14);
    expect(run('round', 2.5)).toBe(3);
    expect(() => compileChain('clamp(1)')).toThrow(AppError);
    expect(() => compileChain('clamp(5,1)')).toThrow(AppError);
  });

  it('default / lookup', () => {
    expect(run('default(active)', '')).toBe('active');
    expect(run('default(0)', null)).toBe(0);
    expect(run('default(x)', 'y')).toBe('y');
    expect(run('lookup(A:active;S:suspended)', 'S')).toBe('suspended');
    expect(run('lookup(A:active)', 'Z')).toBe('Z');
    expect(run('lookup(A:active;*:watch)', 'Z')).toBe('watch');
    expect(run('lookup(1:10)', '1')).toBe(10);
    expect(() => compileChain('lookup(bad)')).toThrow(AppError);
  });

  it('iso3166', () => {
    expect(run('iso3166', 'China')).toBe('CN');
    expect(run('iso3166', 'Vietnam')).toBe('VN');
    expect(run('iso3166', 'viet nam')).toBe('VN');
    expect(run('iso3166', 'United States')).toBe('US');
    expect(run('iso3166', 'jp')).toBe('JP');
    expect(run('iso3166', '中国')).toBe('CN');
    expect(run('iso3166', '')).toBeNull();
    expect(() => run('iso3166', 'Atlantis')).toThrow(TransformError);
  });

  it('split', () => {
    expect(run('split(;)', 'M-1; M-2;;')).toEqual(['M-1', 'M-2']);
    expect(run('split', 'a,b')).toEqual(['a', 'b']);
    expect(run('split(|)', 'a|b')).toEqual(['a', 'b']);
    expect(run('split(;)', '')).toEqual([]);
  });

  it('chains apply left to right', () => {
    expect(run('trim|toNumber|clamp(0,100)', ' 150 ')).toBe(100);
    expect(run('trim|lower|lookup(active:A)', ' ACTIVE ')).toBe('A');
    expect(compileChain(undefined).apply('x')).toBe('x');
  });

  it('rejects chains longer than 5 steps', () => {
    expect(() => compileChain('trim|trim|trim|trim|trim|trim')).toThrow(
      /exceeds 5/,
    );
    expect(() => compileChain('trim|trim|trim|trim|trim')).not.toThrow();
  });

  it('rejects unknown or malformed transforms', () => {
    expect(() => compileChain('trim|explode')).toThrow(
      /Unknown transform: explode/,
    );
    expect(() => compileChain('trim(')).toThrow(/Malformed/);
    expect(() => compileChain('trim(1)')).toThrow(AppError);
  });

  it('registry is open for extension but closed for modification', () => {
    registerTransform(
      'reverse',
      () => v => String(v).split('').reverse().join(''),
    );
    expect(run('reverse|upper', 'abc')).toBe('CBA');
    expect(transformNames()).toContain('reverse');
    expect(() => registerTransform('trim', () => v => v)).toThrow(AppError);
  });
});
