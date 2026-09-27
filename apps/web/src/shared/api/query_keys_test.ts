/**
 * @fileoverview Query key conventions.
 */

import {describe, expect, it} from 'vitest';
import {BUSINESS_PREFIXES, qk} from './query_keys';

describe('qk', () => {
  it('uses the documented keys', () => {
    expect(qk.me()).toEqual(['me']);
    expect(qk.overview()).toEqual(['situation', 'overview']);
    expect(qk.recommendation('r1')).toEqual(['decision', 'rec', 'r1']);
    expect(qk.schema()).toEqual(['ontology', 'schema']);
    expect(qk.archiveDeletion('t')).toEqual(['archive-deletion', 't']);
    expect(qk.admin('users', {status: 'ACTIVE'})).toEqual([
      'admin',
      'users',
      {status: 'ACTIVE'},
    ]);
  });

  it('prefixes business keys by module and never includes the language', () => {
    const keys = [
      qk.overview('24h'),
      qk.alerts({status: 'OPEN'}),
      qk.objects('Supplier', {q: 'a'}),
      qk.object('ri.obj.1'),
      qk.recommendations({status: 'Proposed'}),
      qk.definitions('object-types'),
      qk.import('j1'),
    ];
    for (const k of keys) {
      expect(BUSINESS_PREFIXES).toContain(k[0]);
      expect(JSON.stringify(k)).not.toMatch(/zh-CN|en-US/);
    }
    expect(BUSINESS_PREFIXES).not.toContain('me');
    expect(BUSINESS_PREFIXES).not.toContain('admin');
  });
});
