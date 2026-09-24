/**
 * @fileoverview Tests for automation matching and the rule index.
 */

import {describe, expect, it} from 'vitest';
import type {AutomationDto} from '../contract';
import {AutomationIndex, countCrosses, thresholdMatches} from './automation';

function rule(over: Partial<AutomationDto> = {}): AutomationDto {
  return {
    id: 'a1',
    name: 'Supplier risk high',
    trigger: {kind: 'threshold', objectType: 'Supplier'},
    condition: {op: 'gte', prop: 'riskScore', value: 70},
    effects: [{kind: 'alert'}],
    severity: 'HIGH',
    cooldownSec: 3600,
    enabled: true,
    createdAt: '2026-09-24T00:00:00.000Z',
    ...over,
  };
}

describe('thresholdMatches', () => {
  const cond = {op: 'gte', prop: 'riskScore', value: 70} as const;

  it('fires when a condition prop changed and matches', () => {
    expect(
      thresholdMatches(cond, {
        type: 'Supplier',
        changed: ['riskScore'],
        after: {riskScore: 82},
      }),
    ).toBe(true);
  });

  it('does not fire when the value does not match', () => {
    expect(
      thresholdMatches(cond, {
        type: 'Supplier',
        changed: ['riskScore'],
        after: {riskScore: 20},
      }),
    ).toBe(false);
  });

  it('skips when none of the condition props changed', () => {
    expect(
      thresholdMatches(cond, {
        type: 'Supplier',
        changed: ['name'],
        after: {riskScore: 90, name: 'x'},
      }),
    ).toBe(false);
  });

  it('evaluates on first sight (every prop in changed)', () => {
    expect(
      thresholdMatches(cond, {
        type: 'Supplier',
        changed: ['name', 'riskScore'],
        after: {riskScore: 90, name: 'x'},
      }),
    ).toBe(true);
  });

  it('always evaluates rules without condition', () => {
    expect(
      thresholdMatches(undefined, {type: 'S', changed: ['x'], after: {}}),
    ).toBe(true);
  });
});

describe('AutomationIndex', () => {
  const idx = new AutomationIndex([
    rule(),
    rule({id: 'a2', condition: undefined}),
    rule({
      id: 'a3',
      trigger: {kind: 'threshold', objectType: 'Product'},
      condition: {op: 'lt', prop: 'inventoryDays', value: 5},
    }),
    rule({id: 'a4', enabled: false}),
    rule({
      id: 'a5',
      condition: {
        op: 'and',
        args: [
          {op: 'gte', prop: 'riskScore', value: 50},
          {op: 'eq', prop: 'status', value: 'active'},
        ],
      },
    }),
    rule({
      id: 'c1',
      trigger: {
        kind: 'objectSetCount',
        objectSet: {objectType: 'Supplier'},
        op: 'gt',
        value: 3,
      },
    }),
    rule({
      id: 's1',
      trigger: {kind: 'schedule', objectSet: {objectType: 'Product'}},
    }),
  ]);

  it('returns candidates by type and changed prop, without duplicates', () => {
    const ids = idx
      .candidates({
        type: 'Supplier',
        changed: ['riskScore', 'status'],
        after: {},
      })
      .map(a => a.id)
      .sort();
    expect(ids).toEqual(['a1', 'a2', 'a5']);
  });

  it('matches by condition and ignores disabled rules', () => {
    const ids = idx
      .matching({
        type: 'Supplier',
        changed: ['riskScore'],
        after: {riskScore: 60, status: 'active'},
      })
      .map(a => a.id)
      .sort();
    expect(ids).toEqual(['a2', 'a5']);
  });

  it('only returns rules for unrelated props when unconditional', () => {
    const ids = idx
      .matching({type: 'Supplier', changed: ['name'], after: {riskScore: 99}})
      .map(a => a.id);
    expect(ids).toEqual(['a2']);
  });

  it('exposes count and schedule rules', () => {
    expect(idx.countRulesFor(new Set(['Supplier'])).map(a => a.id)).toEqual([
      'c1',
    ]);
    expect(idx.countRulesFor(new Set(['Product']))).toEqual([]);
    expect(idx.schedules().map(a => a.id)).toEqual(['s1']);
  });

  it('countCrosses', () => {
    expect(countCrosses(4, 'gt', 3)).toBe(true);
    expect(countCrosses(3, 'gt', 3)).toBe(false);
    expect(countCrosses(2, 'lt', 3)).toBe(true);
  });
});
