/**
 * @fileoverview Query key conventions: module prefixes and stable shapes so
 * realtime increments can invalidate precisely.
 */

import {describe, expect, it} from 'vitest';
import {qk, STALE} from './query_keys';

describe('qk', () => {
  it('follows the documented shapes', () => {
    expect(qk.overview()).toEqual(['situation', 'overview']);
    expect(qk.alerts({status: 'OPEN'})).toEqual([
      'situation',
      'alerts',
      {status: 'OPEN'},
    ]);
    expect(qk.object('ri.t1.Supplier.S1')).toEqual([
      'object',
      'ri.t1.Supplier.S1',
    ]);
    expect(qk.objectSet('os-1', 'c2')).toEqual(['object', 'set', 'os-1', 'c2']);
    expect(qk.recommendation('rec-1')).toEqual(['decision', 'rec', 'rec-1']);
    expect(qk.schema('supplyChain', '1.0.0')).toEqual([
      'ontology',
      'supplyChain',
      '1.0.0',
    ]);
  });

  it('prefixes every key with its backend module', () => {
    const modules = new Set([
      'situation',
      'object',
      'decision',
      'ontology',
      'integration',
      'identity',
      'platform',
    ]);
    for (const [name, fn] of Object.entries(qk)) {
      const key = (fn as (...a: unknown[]) => readonly unknown[])('a', 'b', []);
      expect(modules.has(key[0] as string), name).toBe(true);
    }
  });

  it('nests detail keys under their family for prefix invalidation', () => {
    expect(qk.lineage('r').slice(0, 2)).toEqual(qk.object('r'));
    expect(qk.actionLog('r').slice(0, 2)).toEqual(qk.object('r'));
    expect(qk.alerts({}).slice(0, 2)).toEqual(qk.alertsAll());
    expect(qk.recommendations({}).slice(0, 2)).toEqual(qk.recommendationsAll());
    expect(qk.rejected('j').slice(0, 3)).toEqual(qk.job('j'));
  });

  it('never contains the UI language', () => {
    expect(JSON.stringify(qk.overview())).not.toMatch(/zh|en-US/);
  });

  it('uses the documented stale times', () => {
    expect(STALE.overview).toBe(30_000);
    expect(STALE.object).toBe(60_000);
    expect(STALE.schemaVersioned).toBe(Number.POSITIVE_INFINITY);
  });
});
