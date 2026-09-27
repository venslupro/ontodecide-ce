/**
 * @fileoverview Mapping model: deterministic auto-match (exact, synonym,
 * similarity, link columns), AI draft merge with statuses, confirmation,
 * Next-button problems and conversion to a MappingSpec.
 */

import type {MappingDraft} from '@ontodecide/integration/contract';
import {describe, expect, it} from 'vitest';
import {toUiModel} from '../../entities/schema/model';
import {ontologyDto} from '../../test/fixtures/business';
import {
  applyDraft,
  autoMatch,
  confirmRow,
  dismissRow,
  fieldStatus,
  mappingProblems,
  parseTargetValue,
  setTarget,
  targetValue,
  toMappingSpec,
  usedColumns,
} from './mapping';

const model = toUiModel(ontologyDto, 'zh-CN');
const supplier = model.byName.Supplier;
const FIELDS = [
  'vendor_code',
  'vendor_name',
  'risk',
  'addr.country',
  'cap_wk',
  'sku_list',
  'note',
];
const SAMPLES = [{sku_list: 'M-2231,M-2240'}];

describe('autoMatch', () => {
  const rows = autoMatch(FIELDS, supplier, model, SAMPLES);
  const by = (s: string) => rows.find(r => r.source === s)!;

  it('matches by synonym and similarity with type-based transforms', () => {
    expect(by('vendor_code')).toMatchObject({
      target: {kind: 'prop', prop: 'supplierId'},
      matchedBy: 'synonym',
      transform: 'trim',
    });
    expect(by('vendor_name').target).toEqual({kind: 'prop', prop: 'name'});
    expect(by('risk')).toMatchObject({
      target: {kind: 'prop', prop: 'riskScore'},
      transform: 'trim|toNumber',
    });
    expect(by('addr.country')).toMatchObject({
      target: {kind: 'prop', prop: 'country'},
      matchedBy: 'similarity',
    });
    expect(by('cap_wk').transform).toBe('trim|toInteger');
    expect(fieldStatus(by('risk'))).toBe('deterministic');
  });

  it('detects link columns with their separator as pending', () => {
    expect(by('sku_list')).toMatchObject({
      target: {kind: 'link', linkType: 'supplies', toType: 'Material'},
      split: ',',
    });
    expect(fieldStatus(by('sku_list'))).toBe('pending');
    expect(by('note').target).toBeNull();
  });

  it('matches the exact name first', () => {
    const r = autoMatch(['supplierId', 'vendor_code'], supplier, model);
    expect(r[0]).toMatchObject({matchedBy: 'exact'});
    expect(r[1].target).toBeNull();
  });
});

describe('applyDraft and confirmation', () => {
  const base = autoMatch(
    ['vendor_code', 'vendor_name', 'otd_pct'],
    supplier,
    model,
  );
  const draft: MappingDraft = {
    targetType: 'Supplier',
    primaryKey: {from: 'vendor_code', transform: 'trim'},
    fields: [
      {to: 'supplierId', from: 'vendor_code', matchedBy: 'exact'},
      {
        to: 'onTimeRate',
        from: 'otd_pct',
        transform: 'toNumber',
        matchedBy: 'ai',
      },
    ],
    rankedBy: 'ai',
    unmatched: [],
  };

  it('marks AI suggestions, which block Next until confirmed', () => {
    const rows = applyDraft(base, draft, supplier, model);
    const otd = rows.find(r => r.source === 'otd_pct')!;
    expect(fieldStatus(otd)).toBe('ai');
    expect(otd.transform).toBe('toNumber');
    expect(mappingProblems(rows, supplier)).toEqual([
      {code: 'AI_UNCONFIRMED', count: 1},
    ]);
    const confirmed = rows.map(r =>
      r.source === 'otd_pct' ? confirmRow(r) : r,
    );
    expect(fieldStatus(confirmed[2])).toBe('confirmed');
    expect(mappingProblems(confirmed, supplier)).toEqual([]);
    const dismissed = rows.map(r =>
      r.source === 'otd_pct' ? dismissRow(r) : r,
    );
    expect(fieldStatus(dismissed[2])).toBe('pending');
    expect(mappingProblems(dismissed, supplier)).toEqual([]);
  });

  it('keeps rows the user already confirmed', () => {
    const manual = base.map(r =>
      r.source === 'otd_pct'
        ? setTarget(r, {kind: 'prop', prop: 'riskScore'}, supplier)
        : r,
    );
    const rows = applyDraft(manual, draft, supplier, model);
    expect(rows[2]).toMatchObject({
      target: {kind: 'prop', prop: 'riskScore'},
      matchedBy: 'manual',
      confirmed: true,
    });
  });
});

describe('mappingProblems / toMappingSpec', () => {
  it('requires the primary key and required properties, once each', () => {
    const rows = autoMatch(['risk', 'risk2'], supplier, model).map(r =>
      setTarget(r, {kind: 'prop', prop: 'riskScore'}, supplier),
    );
    rows[0] = {...rows[0], transform: 'trim|nope'};
    const codes = mappingProblems(rows, supplier).map(p => p.code);
    expect(codes).toEqual([
      'CHAIN_INVALID',
      'PRIMARY_KEY_UNMAPPED',
      'REQUIRED_UNMAPPED',
      'DUPLICATE_TARGET',
    ]);
  });

  it('builds the spec with primary key, fields and links', () => {
    const rows = autoMatch(FIELDS, supplier, model, SAMPLES);
    const spec = toMappingSpec(rows, supplier);
    expect(spec.targetType).toBe('Supplier');
    expect(spec.primaryKey).toEqual({from: 'vendor_code', transform: 'trim'});
    expect(spec.fields.map(f => f.to)).toEqual([
      'supplierId',
      'name',
      'riskScore',
      'country',
      'capacityPerWeek',
    ]);
    expect(spec.fields[0].matchedBy).toBe('synonym');
    expect(spec.links).toEqual([
      {type: 'supplies', toType: 'Material', toKey: 'sku_list', split: ','},
    ]);
    expect(usedColumns(spec)).not.toContain('note');
  });

  it('round-trips select values', () => {
    expect(
      parseTargetValue(targetValue({kind: 'prop', prop: 'x'}), model),
    ).toEqual({
      kind: 'prop',
      prop: 'x',
    });
    expect(parseTargetValue('link:supplies', model)).toEqual({
      kind: 'link',
      linkType: 'supplies',
      toType: 'Material',
    });
    expect(parseTargetValue('', model)).toBeNull();
  });
});
