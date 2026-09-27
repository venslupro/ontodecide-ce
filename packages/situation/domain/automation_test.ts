/**
 * @fileoverview Tests of automation validation, schedule arithmetic and the
 * inverted rule index.
 */

import {describe, expect, it} from 'vitest';
import {AppError, HOUR_MS} from '@ontodecide/shared-kernel';
import type {AutomationDef} from '../contract/types';
import {
  type AutomationRule,
  RuleIndex,
  advanceRun,
  earliest,
  firstRunAt,
  validateAutomation,
} from './automation';

const threshold: AutomationDef = {
  name: 'High risk',
  trigger: 'threshold',
  objectType: 'Supplier',
  condition: {op: 'gte', prop: 'risk', value: 80},
  severity: 'HIGH',
  cooldownSec: 3600,
  enabled: true,
};
const schedule: AutomationDef = {
  ...threshold,
  trigger: 'schedule',
  everyHours: 6,
};

function code(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return AppError.from(e).code;
  }
}

describe('validateAutomation', () => {
  it('accepts up to three scheduled rules', () => {
    expect(validateAutomation(schedule, 2)).toEqual(schedule);
    expect(code(() => validateAutomation(schedule, 3))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('does not count threshold rules against the schedule limit', () => {
    expect(code(() => validateAutomation(threshold, 3))).toBeNull();
  });

  it('requires an interval of 1..24 hours', () => {
    for (const everyHours of [0, 0.5, 25, undefined]) {
      expect(code(() => validateAutomation({...schedule, everyHours}, 0))).toBe(
        'VALIDATION_FAILED',
      );
    }
    expect(
      code(() => validateAutomation({...schedule, everyHours: 1}, 0)),
    ).toBeNull();
  });

  it('bounds the cooldown and strips everyHours from threshold rules', () => {
    expect(
      code(() => validateAutomation({...threshold, cooldownSec: -1}, 0)),
    ).toBe('VALIDATION_FAILED');
    expect(
      code(() => validateAutomation({...threshold, cooldownSec: 86_401}, 0)),
    ).toBe('VALIDATION_FAILED');
    expect(
      validateAutomation({...threshold, everyHours: 3}, 0).everyHours,
    ).toBeUndefined();
  });
});

describe('schedule arithmetic', () => {
  it('keeps the phase and skips missed slots', () => {
    const t0 = 1_000 * HOUR_MS;
    expect(firstRunAt(t0, 2)).toBe(t0 + 2 * HOUR_MS);
    expect(advanceRun(t0, 2, t0)).toBe(t0 + 2 * HOUR_MS);
    expect(advanceRun(t0, 2, t0 + 5 * HOUR_MS)).toBe(t0 + 6 * HOUR_MS);
    expect(advanceRun(t0, 2, t0 + 6 * HOUR_MS)).toBe(t0 + 8 * HOUR_MS);
  });

  it('picks the earliest instant', () => {
    expect(earliest(null, 5, undefined, 3)).toBe(3);
    expect(earliest(null, undefined)).toBeNull();
  });
});

describe('RuleIndex', () => {
  const rule = (
    id: string,
    extra: Partial<AutomationRule>,
  ): AutomationRule => ({
    id,
    trigger: 'threshold',
    objectType: 'Supplier',
    condition: {op: 'gte', prop: 'risk', value: 80},
    everyHours: null,
    enabled: true,
    cooldownSec: 0,
    ...extra,
  });
  const index = new RuleIndex([
    rule('risk', {}),
    rule('stock', {
      condition: {
        op: 'and',
        args: [
          {op: 'lt', prop: 'stock', value: 5},
          {op: 'eq', prop: 'status', value: 'active'},
        ],
      },
    }),
    rule('always', {condition: {op: 'and', args: []}}),
    rule('part', {objectType: 'Part'}),
    rule('off', {enabled: false}),
    rule('sched', {trigger: 'schedule', everyHours: 1}),
  ]);
  const ids = (rs: AutomationRule[]) => rs.map(r => r.id).sort();

  it('returns rules referencing a changed property', () => {
    expect(ids(index.candidates('Supplier', ['risk'], false))).toEqual([
      'always',
      'risk',
    ]);
    expect(ids(index.candidates('Supplier', ['status'], false))).toEqual([
      'always',
      'stock',
    ]);
    expect(ids(index.candidates('Supplier', ['name'], false))).toEqual([
      'always',
    ]);
  });

  it('returns all rules of the type for whole-object changes', () => {
    expect(ids(index.candidates('Supplier', [], true))).toEqual([
      'always',
      'risk',
      'stock',
    ]);
    expect(ids(index.forType('Part'))).toEqual(['part']);
  });

  it('skips disabled and scheduled rules', () => {
    expect(ids(index.forType('Supplier'))).not.toContain('off');
    expect(ids(index.forType('Supplier'))).not.toContain('sched');
  });
});
