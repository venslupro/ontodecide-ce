/**
 * @fileoverview Client mapping preview mirrors the server mapping engine:
 * transforms, schema coercion, quality rules (reject / clamp / defer),
 * links, and aggregated stats; AI suggestions are inert until confirmed.
 */

import type {MappingSpec, QualityRule} from '@ontodecide/integration/contract';
import {describe, expect, it} from 'vitest';
import {compiledModel} from '../../test/fixtures';
import {previewRow, previewStats, qualityRuleProblem} from './preview';
import {
  acceptAllAi,
  applySuggestion,
  buildMapping,
  emptyDraft,
  guessPrimaryKey,
  pendingAiCount,
} from './wizard';

const supplier = compiledModel.objectTypes.Supplier;
const mapping: MappingSpec = {
  targetType: 'Supplier',
  primaryKey: {from: 'supplierId', transform: 'trim'},
  fields: [
    {to: 'name', from: 'name', transform: 'trim'},
    {to: 'riskScore', from: 'riskScore', transform: 'toNumber'},
  ],
  links: [
    {
      type: 'supplies',
      toType: 'Material',
      toKey: 'materials',
      split: ';',
      weightFrom: 'share',
    },
  ],
};
const now = new Date('2026-09-24T08:00:00Z');

describe('previewRow', () => {
  it('maps, coerces and links a record', () => {
    const r = previewRow(
      {
        supplierId: ' S-1 ',
        name: ' Acme ',
        riskScore: '35',
        materials: 'M-1;M-2',
        share: '0.5',
      },
      1,
      {
        mapping,
        rules: [],
        targetType: supplier,
        now,
      },
    );
    expect(r).toMatchObject({
      ok: true,
      primaryKey: 'S-1',
      props: {name: 'Acme', riskScore: 35, supplierId: 'S-1'},
    });
    if (!r.ok) throw new Error();
    expect(r.links).toEqual([
      {type: 'supplies', toType: 'Material', toKey: 'M-1', weight: 0.5},
      {type: 'supplies', toType: 'Material', toKey: 'M-2', weight: 0.5},
    ]);
  });

  it('rejects missing keys, bad transforms and failing rules; clamps ranges', () => {
    const ctx = (rules: QualityRule[]) => ({
      mapping,
      rules,
      targetType: supplier,
      now,
    });
    expect(previewRow({supplierId: '', name: 'x'}, 1, ctx([]))).toMatchObject({
      ok: false,
      code: 'PRIMARY_KEY_MISSING',
    });
    expect(
      previewRow({supplierId: 'S', name: 'x', riskScore: 'abc'}, 2, ctx([])),
    ).toMatchObject({ok: false, code: 'TRANSFORM_FAILED'});
    expect(previewRow({supplierId: 'S', name: ''}, 3, ctx([]))).toMatchObject({
      ok: false,
      code: 'PROP_INVALID',
    });
    const clamp = previewRow(
      {supplierId: 'S', name: 'x', riskScore: '150'},
      4,
      ctx([{prop: 'riskScore', kind: 'range', arg: [0, 100], onFail: 'clamp'}]),
    );
    expect(clamp).toMatchObject({
      ok: true,
      props: {riskScore: 100},
      clamped: ['riskScore'],
    });
    const rej = previewRow(
      {supplierId: 'S', name: 'x', riskScore: '150'},
      5,
      ctx([
        {prop: 'riskScore', kind: 'range', arg: [0, 100], onFail: 'reject'},
      ]),
    );
    expect(rej).toMatchObject({ok: false, code: 'QUALITY_FAILED'});
    const defer = previewRow(
      {supplierId: 'S', name: 'x'},
      6,
      ctx([{prop: 'country', kind: 'required', onFail: 'defer'}]),
    );
    expect(defer).toMatchObject({
      ok: true,
      warnings: ['required: country is required'],
    });
  });

  it('aggregates stats with grouped reasons', () => {
    const rows = [
      {supplierId: 'A', name: 'a', riskScore: '10'},
      {supplierId: 'B', name: 'b', riskScore: '120'},
      {supplierId: '', name: 'c'},
      {supplierId: '', name: 'd'},
    ];
    const s = previewStats(rows, {
      mapping,
      rules: [
        {prop: 'riskScore', kind: 'range', arg: [0, 100], onFail: 'clamp'},
      ],
      targetType: supplier,
      now,
    });
    expect(s).toMatchObject({total: 4, valid: 2, rejected: 2, clamped: 1});
    expect(s.reasons).toEqual([
      {
        code: 'PRIMARY_KEY_MISSING',
        detail: 'supplierId is empty',
        count: 2,
        example: 3,
      },
    ]);
  });

  it('validates rule definitions like the server', () => {
    expect(
      qualityRuleProblem({prop: 'x', kind: 'required', onFail: 'clamp'}),
    ).toBe('CLAMP_NOT_RANGE');
    expect(
      qualityRuleProblem({
        prop: 'x',
        kind: 'range',
        arg: [5, 1],
        onFail: 'reject',
      }),
    ).toBe('RANGE_ARG');
    expect(
      qualityRuleProblem({
        prop: 'x',
        kind: 'format',
        arg: '(',
        onFail: 'reject',
      }),
    ).toBe('FORMAT_ARG');
    expect(
      qualityRuleProblem({
        prop: 'x',
        kind: 'freshness',
        arg: 0,
        onFail: 'defer',
      }),
    ).toBe('FRESHNESS_ARG');
    expect(
      qualityRuleProblem({
        prop: 'x',
        kind: 'range',
        arg: [0, 1],
        onFail: 'clamp',
      }),
    ).toBeNull();
  });
});

describe('wizard draft', () => {
  it('guesses the primary key and keeps AI suggestions inert until accepted', () => {
    const fields = ['supplier_id', 'name', 'riskScore'];
    const pk = guessPrimaryKey(fields, {
      primaryKey: 'supplierId',
      apiName: 'Supplier',
    });
    expect(pk).toBe('supplier_id');
    const draft = applySuggestion(
      emptyDraft(fields, pk),
      {
        targetType: 'Supplier',
        primaryKey: {from: pk},
        fields: [
          {
            from: 'riskScore',
            to: 'riskScore',
            transform: 'toNumber',
            confidence: 0.8,
          },
        ],
        model: 'm',
      },
      undefined,
    );
    expect(pendingAiCount(draft)).toBe(1);
    expect(buildMapping(draft, 'Supplier').fields).toEqual([]);
    const accepted = acceptAllAi(draft);
    expect(buildMapping(accepted, 'Supplier').fields).toEqual([
      {to: 'riskScore', from: 'riskScore', transform: 'toNumber'},
    ]);
  });
});
