import {describe, expect, it} from 'vitest';
import {systemCtx} from '@ontodecide/shared-kernel';
import type {CallCtx} from '@ontodecide/shared-kernel';
import {filterByMarkings, hiddenPropNames} from './markings';

const testCtx = (extra: Partial<CallCtx> = {}): CallCtx => ({
  tenantId: 't1',
  userId: 'u1',
  roles: ['Viewer'],
  markings: [],
  requestId: 'r',
  correlationId: 'c',
  ...extra,
});

const type = {
  properties: [
    {apiName: 'name'},
    {apiName: 'contactEmail', markings: ['PII']},
    {apiName: 'secret', markings: ['PII', 'FINANCE']},
  ],
};
const props = {name: 'Acme', contactEmail: 'a@x', secret: 1};
const provenance = {name: {} as never, contactEmail: {} as never};

describe('markings', () => {
  it('hides properties unless the caller holds all markings', () => {
    const none = filterByMarkings(
      testCtx({markings: []}),
      type,
      props,
      provenance,
    );
    expect(none.props).toEqual({name: 'Acme'});
    expect(Object.keys(none.provenance)).toEqual(['name']);
    expect(none.hiddenProps.sort()).toEqual(['contactEmail', 'secret']);

    const pii = filterByMarkings(testCtx({markings: ['PII']}), type, props);
    expect(pii.props).toEqual({name: 'Acme', contactEmail: 'a@x'});
    expect(pii.hiddenProps).toEqual(['secret']);

    const all = filterByMarkings(
      testCtx({markings: ['PII', 'FINANCE']}),
      type,
      props,
    );
    expect(all.hiddenProps).toEqual([]);
  });

  it('lets system contexts see everything', () => {
    expect(hiddenPropNames(systemCtx('t1'), type).size).toBe(0);
    expect(filterByMarkings(systemCtx('t1'), type, props).props).toEqual(props);
  });

  it('only lists hidden properties present on the object', () => {
    const v = filterByMarkings(testCtx(), type, {name: 'x'});
    expect(v.hiddenProps).toEqual([]);
  });
});
