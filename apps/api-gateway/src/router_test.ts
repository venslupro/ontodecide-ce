/**
 * @fileoverview Tests for the segment router.
 */

import {describe, expect, it} from 'vitest';
import {Router} from './router';

describe('Router', () => {
  const router = new Router<string>()
    .add('GET', '/recommendations', 'list')
    .add('GET', '/recommendations/:id', 'get')
    .add('POST', '/recommendations:generate', 'generate')
    .add('POST', '/recommendations/:id/approve', 'approve')
    .add('POST', '/sources/:id/uploads:presign', 'presign')
    .add('POST', '/users/:id/password:reset', 'reset')
    .add('GET', '/objects/:type', 'listObjects')
    .add('GET', '/objects/rid/:rid', 'getObject')
    .add('POST', '/object-sets:evaluate', 'evalAdhoc')
    .add('POST', '/object-sets/:id/evaluate', 'evalSaved');

  it('treats colon-containing segments as literals', () => {
    expect(router.match('POST', '/recommendations:generate')).toEqual({
      kind: 'found',
      value: 'generate',
      params: {},
    });
    expect(router.match('POST', '/sources/s1/uploads:presign')).toEqual({
      kind: 'found',
      value: 'presign',
      params: {id: 's1'},
    });
    expect(router.match('POST', '/users/u9/password:reset')).toMatchObject({
      value: 'reset',
      params: {id: 'u9'},
    });
    expect(router.match('POST', '/object-sets:evaluate')).toMatchObject({
      value: 'evalAdhoc',
    });
  });

  it('extracts and decodes params', () => {
    expect(router.match('GET', '/recommendations/r%201')).toMatchObject({
      value: 'get',
      params: {id: 'r 1'},
    });
    expect(
      router.match('GET', '/objects/rid/ri.t1.Supplier.01ABC'),
    ).toMatchObject({
      value: 'getObject',
      params: {rid: 'ri.t1.Supplier.01ABC'},
    });
    expect(router.match('GET', '/objects/Supplier')).toMatchObject({
      value: 'listObjects',
      params: {type: 'Supplier'},
    });
  });

  it('does not treat a colon literal as a param match', () => {
    expect(router.match('POST', '/recommendations:other').kind).toBe(
      'not_found',
    );
    expect(router.match('POST', '/sources/s1/uploads').kind).toBe('not_found');
  });

  it('returns 405 with allowed methods and 404 otherwise', () => {
    expect(router.match('DELETE', '/recommendations')).toEqual({
      kind: 'method_not_allowed',
      allow: ['GET'],
    });
    expect(router.match('GET', '/nope')).toEqual({kind: 'not_found'});
    expect(router.match('GET', '/recommendations/a/b/c')).toEqual({
      kind: 'not_found',
    });
  });

  it('ignores trailing slashes', () => {
    expect(router.match('GET', '/recommendations/')).toMatchObject({
      value: 'list',
    });
  });
});
