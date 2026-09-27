/**
 * @fileoverview Tests of action parameters, preconditions and effects.
 */

import {describe, expect, it} from 'vitest';
import {AppError} from '@ontodecide/shared-kernel';
import type {Rid} from '@ontodecide/shared-kernel';
import type {
  ActionTypeDef,
  CompiledSchema,
} from '@ontodecide/ontology/contract';
import {
  actionData,
  applyEffects,
  pick,
  resolveParams,
  touchedLinkTypes,
  unmetPreconditions,
} from './action_execution';
import type {StoredObject} from './stored_object';

const supplierType = {
  apiName: 'Supplier',
  displayName: 'S',
  primaryKey: 'id',
  titleProperty: 'id',
  properties: [
    {apiName: 'id', displayName: 'id', dataType: 'string', required: true},
    {apiName: 'score', displayName: 'score', dataType: 'double'},
    {apiName: 'count', displayName: 'count', dataType: 'integer'},
    {
      apiName: 'status',
      displayName: 'status',
      dataType: 'enum',
      enumValues: ['A', 'B'],
    },
  ],
  indexedProps: [],
  sensitiveProps: [],
} as unknown as CompiledSchema['objectTypes'][string];
supplierType.propsByName = Object.fromEntries(
  supplierType.properties.map(p => [p.apiName, p]),
);

const schema = {
  objectTypes: {
    Supplier: supplierType,
    Part: {...supplierType, apiName: 'Part'},
  },
  linkTypes: {
    supplies: {
      apiName: 'supplies',
      displayName: 's',
      from: 'Supplier',
      to: 'Part',
      cardinality: 'many',
    },
  },
} as unknown as CompiledSchema;

const S = 'ri.Supplier.0000000000000000000000000S' as Rid;
const S2 = 'ri.Supplier.000000000000000000000000S2' as Rid;
const P = 'ri.Part.00000000000000000000000000P' as Rid;

const target: StoredObject = {
  rid: P,
  type: 'Part',
  primaryKey: 'P',
  title: 'P',
  props: {id: 'P', score: 0.5, count: 2, status: 'A'},
  provenance: {score: {jobId: 'j', row: 1, at: 1}},
  propsHash: 'h',
  version: 1,
  updatedAt: 0,
};

function action(over: Partial<ActionTypeDef>): ActionTypeDef {
  return {
    apiName: 'a',
    displayName: 'a',
    targetType: 'Part',
    parameters: [],
    preconditions: [],
    effects: [],
    ...over,
  };
}

describe('resolveParams', () => {
  const a = action({
    parameters: [
      {apiName: 'n', displayName: 'n', dataType: 'integer', required: true},
      {apiName: 'd', displayName: 'd', dataType: 'double', defaultValue: 0.5},
      {apiName: 'who', displayName: 'w', dataType: 'objectRef:Supplier'},
    ],
  });

  it('coerces, applies defaults and collects object refs', () => {
    const r = resolveParams(a, {n: '3', who: S});
    expect(r.params).toEqual({n: 3, d: 0.5, who: S});
    expect(r.refs).toEqual([{param: 'who', objectType: 'Supplier', rid: S}]);
  });

  it('rejects unknown, missing and invalid parameters', () => {
    for (const bad of [{}, {n: 'x'}, {n: 1, extra: true}]) {
      expect(() => resolveParams(a, bad)).toThrow(AppError);
    }
  });
});

describe('preconditions', () => {
  it('returns messages of falsy expressions in the locale', () => {
    const a = action({
      preconditions: [
        {expr: {'>': [{var: 'target.score'}, 0.1]}, message: 'ok'},
        {
          expr: {'==': [{var: 'params.x'}, 1]},
          message: {'en-US': 'x must be 1', 'zh-CN': 'x 必须为 1'},
        },
      ],
    });
    const data = actionData(target, {x: 2});
    expect(unmetPreconditions(a, data, 'en-US')).toEqual(['x must be 1']);
    expect(unmetPreconditions(a, data, 'zh-CN')).toEqual(['x 必须为 1']);
    expect(unmetPreconditions(a, actionData(target, {x: 1}), 'en-US')).toEqual(
      [],
    );
  });
});

describe('applyEffects', () => {
  const base = {
    schema,
    type: schema.objectTypes.Part,
    target,
    refTypes: new Map<string, string>(),
    links: [],
  };

  it('sets and increments properties, coercing by type', () => {
    const a = action({
      effects: [
        {kind: 'set', prop: 'status', value: 'B'},
        {kind: 'increment', prop: 'count', by: {'*': [{var: 'params.k'}, 1.5]}},
        {kind: 'increment', prop: 'score', by: 0.25},
      ],
    });
    const r = applyEffects({...base, action: a, params: {k: 2}});
    expect(r.after.props).toMatchObject({status: 'B', count: 5, score: 0.75});
    expect(r.changed.sort()).toEqual(['count', 'score', 'status']);
    expect(r.after.provenance.score).toBeUndefined();
    expect(pick(r.after.props, ['count'])).toEqual({count: 5});
  });

  it('clears a property set to null and rejects invalid results', () => {
    const clear = action({
      effects: [{kind: 'set', prop: 'score', value: null}],
    });
    expect(
      applyEffects({...base, action: clear, params: {}}).after.props.score,
    ).toBeUndefined();
    const bad = action({effects: [{kind: 'set', prop: 'status', value: 'Z'}]});
    expect(() => applyEffects({...base, action: bad, params: {}})).toThrow(
      AppError,
    );
    const req = action({effects: [{kind: 'set', prop: 'id', value: null}]});
    expect(() => applyEffects({...base, action: req, params: {}})).toThrow(
      AppError,
    );
    const unknown = action({effects: [{kind: 'set', prop: 'ghost', value: 1}]});
    expect(() => applyEffects({...base, action: unknown, params: {}})).toThrow(
      AppError,
    );
  });

  it('relinks and unlinks incoming links of the target', () => {
    const links = [{src: S, type: 'supplies', dst: P, weight: 0.4}];
    const refTypes = new Map([
      [S2, 'Supplier'],
      [S, 'Supplier'],
    ]);
    const relink = action({
      effects: [
        {kind: 'relink', link: 'supplies', direction: 'in', toParam: 'to'},
      ],
    });
    expect(touchedLinkTypes(relink)).toEqual(['supplies']);
    const r = applyEffects({
      ...base,
      action: relink,
      params: {to: S2},
      links,
      refTypes,
    });
    expect(r.removeLinks).toEqual(links);
    expect(r.addLinks).toEqual([
      {src: S2, type: 'supplies', dst: P, weight: null},
    ]);
    expect(r.changed).toEqual([]);

    const unlink = action({
      effects: [
        {kind: 'unlink', link: 'supplies', direction: 'in', toParam: 'from'},
      ],
    });
    const u = applyEffects({
      ...base,
      action: unlink,
      params: {from: S2},
      links,
      refTypes,
    });
    expect(u.removeLinks).toEqual([]);
    const u2 = applyEffects({
      ...base,
      action: unlink,
      params: {from: S},
      links,
      refTypes,
    });
    expect(u2.removeLinks).toEqual(links);

    const wrongType = new Map([[S2, 'Part']]);
    expect(() =>
      applyEffects({
        ...base,
        action: relink,
        params: {to: S2},
        links,
        refTypes: wrongType,
      }),
    ).toThrow(AppError);
    const outward = action({
      effects: [
        {kind: 'relink', link: 'supplies', direction: 'out', toParam: 'to'},
      ],
    });
    expect(() =>
      applyEffects({
        ...base,
        action: outward,
        params: {to: S2},
        links,
        refTypes,
      }),
    ).toThrow(AppError);
  });
});
