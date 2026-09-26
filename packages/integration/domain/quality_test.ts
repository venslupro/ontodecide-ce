/**
 * @fileoverview Tests for quality rules.
 */

import {describe, expect, it} from 'vitest';
import type {QualityRule} from '../contract';
import {applyQualityRules, validateQualityRules} from './quality';

const now = new Date('2026-09-24T00:00:00Z');
const base = {record: {}, now};

describe('quality rules', () => {
  it('required rejects blank values', () => {
    const rules: QualityRule[] = [
      {prop: 'name', kind: 'required', onFail: 'reject'},
    ];
    expect(applyQualityRules(rules, {...base, props: {name: 'x'}}).ok).toBe(
      true,
    );
    const r = applyQualityRules(rules, {...base, props: {name: '  '}});
    expect(r).toMatchObject({ok: false, code: 'QUALITY_FAILED'});
  });

  it('range rejects, clamps or defers', () => {
    const reject: QualityRule[] = [
      {prop: 'riskScore', kind: 'range', arg: [0, 100], onFail: 'reject'},
    ];
    expect(
      applyQualityRules(reject, {...base, props: {riskScore: 120}}).ok,
    ).toBe(false);
    expect(
      applyQualityRules(reject, {...base, props: {riskScore: 50}}).ok,
    ).toBe(true);
    expect(applyQualityRules(reject, {...base, props: {}}).ok).toBe(true);

    const clamp: QualityRule[] = [
      {prop: 'riskScore', kind: 'range', arg: [0, 100], onFail: 'clamp'},
    ];
    expect(
      applyQualityRules(clamp, {...base, props: {riskScore: 120}}),
    ).toEqual({
      ok: true,
      props: {riskScore: 100},
      warnings: [],
    });

    const defer: QualityRule[] = [
      {prop: 'riskScore', kind: 'range', arg: [0, 100], onFail: 'defer'},
    ];
    const d = applyQualityRules(defer, {...base, props: {riskScore: -1}});
    expect(d.ok && d.props.riskScore).toBe(-1);
    expect(d.ok && d.warnings).toHaveLength(1);
  });

  it('format matches regex', () => {
    const rules: QualityRule[] = [
      {
        prop: 'contactEmail',
        kind: 'format',
        arg: '^[^@]+@[^@]+$',
        onFail: 'reject',
      },
    ];
    expect(
      applyQualityRules(rules, {...base, props: {contactEmail: 'a@b'}}).ok,
    ).toBe(true);
    expect(
      applyQualityRules(rules, {...base, props: {contactEmail: 'nope'}}).ok,
    ).toBe(false);
  });

  it('freshness compares against sourceTs', () => {
    const rules: QualityRule[] = [
      {prop: 'updatedAt', kind: 'freshness', arg: 24, onFail: 'reject'},
    ];
    const fresh = applyQualityRules(rules, {
      ...base,
      props: {},
      sourceTs: '2026-09-23T12:00:00Z',
    });
    expect(fresh.ok).toBe(true);
    const old = applyQualityRules(rules, {
      ...base,
      props: {},
      sourceTs: '2026-09-20T00:00:00Z',
    });
    expect(old.ok).toBe(false);
    expect(applyQualityRules(rules, {...base, props: {}}).ok).toBe(false);
  });

  it('ref requires a non-empty key (falls back to raw record fields)', () => {
    const rules: QualityRule[] = [
      {prop: 'materials', kind: 'ref', arg: 'Material', onFail: 'reject'},
    ];
    expect(
      applyQualityRules(rules, {now, props: {}, record: {materials: 'M-1'}}).ok,
    ).toBe(true);
    expect(
      applyQualityRules(rules, {now, props: {}, record: {materials: ''}}).ok,
    ).toBe(false);
  });

  it('validates rule definitions', () => {
    expect(() =>
      validateQualityRules([{prop: 'a', kind: 'required', onFail: 'clamp'}]),
    ).toThrow(/clamp/);
    expect(() =>
      validateQualityRules([
        {prop: 'a', kind: 'range', arg: [5, 1], onFail: 'reject'},
      ]),
    ).toThrow();
    expect(() =>
      validateQualityRules([
        {prop: 'a', kind: 'format', arg: '(', onFail: 'reject'},
      ]),
    ).toThrow();
  });
});
