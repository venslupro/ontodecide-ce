/**
 * @fileoverview Router tests: `{param}` patterns, literal precedence and
 * decoding.
 */

import {describe, expect, it} from 'vitest';
import {Router, compilePattern} from './router';

describe('Router', () => {
  const r = new Router<string>()
    .add('GET', '/objects/{rid}', 'getObject')
    .add('GET', '/objects/stats', 'stats')
    .add('GET', '/objects/{rid}/links', 'links')
    .add('POST', '/objects/{rid}', 'post');

  it('prefers literal segments over parameters', () => {
    expect(r.match('GET', '/objects/stats')).toMatchObject({value: 'stats'});
    expect(r.match('GET', '/objects/ri.A.1')).toMatchObject({
      value: 'getObject',
      params: {rid: 'ri.A.1'},
    });
  });

  it('matches by method, HEAD falls back to GET', () => {
    expect(r.match('POST', '/objects/x')).toMatchObject({value: 'post'});
    expect(r.match('HEAD', '/objects/x')).toMatchObject({value: 'getObject'});
    expect(r.match('DELETE', '/objects/x')).toEqual({kind: 'not_found'});
  });

  it('decodes parameters and rejects malformed escapes', () => {
    expect(r.match('GET', '/objects/a%20b/links')).toMatchObject({
      params: {rid: 'a b'},
    });
    expect(r.match('GET', '/objects/%E0%A4%A')).toEqual({kind: 'not_found'});
  });

  it('compiles only {name} segments as parameters', () => {
    expect(compilePattern('/a/{id}/b')).toEqual([
      {kind: 'literal', value: 'a'},
      {kind: 'param', name: 'id'},
      {kind: 'literal', value: 'b'},
    ]);
  });
});
