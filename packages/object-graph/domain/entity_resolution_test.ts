import {describe, expect, it} from 'vitest';
import type {Rid} from '@ontodecide/shared-kernel';
import {
  bestFuzzyMatch,
  fuzzyBucket,
  jaro,
  jaroWinkler,
  normalizeTitle,
} from './entity_resolution';

describe('entity resolution', () => {
  it('computes Jaro / Jaro-Winkler for known pairs', () => {
    expect(jaro('MARTHA', 'MARHTA')).toBeCloseTo(0.9444, 3);
    expect(jaroWinkler('MARTHA', 'MARHTA')).toBeCloseTo(0.9611, 3);
    expect(jaroWinkler('DWAYNE', 'DUANE')).toBeCloseTo(0.84, 2);
    expect(jaroWinkler('DIXON', 'DICKSONX')).toBeCloseTo(0.8133, 3);
    expect(jaroWinkler('abc', 'abc')).toBe(1);
    expect(jaroWinkler('', 'abc')).toBe(0);
  });

  it('normalizes with NFKC, strips punctuation and lowercases', () => {
    expect(normalizeTitle('  ＡＣＭＥ, Inc.  ')).toBe('acme inc');
    expect(fuzzyBucket('“Acme”')).toBe('a');
    expect(fuzzyBucket('...')).toBe('');
  });

  it('suggests the best match above the threshold within the bucket', () => {
    const c = [
      {rid: 'ri.t.S.1' as Rid, title: 'Acme Metals'},
      {rid: 'ri.t.S.2' as Rid, title: 'Beta Parts'},
      {rid: 'ri.t.S.3' as Rid, title: 'Zcme Metals'},
    ];
    expect(bestFuzzyMatch('ACME Metal', c)?.rid).toBe('ri.t.S.1');
    expect(bestFuzzyMatch('Acme Metals', c, {exclude: 'ri.t.S.1'})).toBeNull();
    expect(bestFuzzyMatch('Totally different', c)).toBeNull();
  });

  it('skips fuzzy matching above 200 candidates', () => {
    const many = Array.from({length: 201}, (_, i) => ({
      rid: `ri.t.S.${i}` as Rid,
      title: 'Acme Metals',
    }));
    expect(bestFuzzyMatch('Acme Metals', many)).toBeNull();
    expect(bestFuzzyMatch('Acme Metals', many.slice(0, 200))?.score).toBe(1);
  });
});
