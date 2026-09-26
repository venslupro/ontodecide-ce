/**
 * @fileoverview Tests for the recommendation state machine.
 */

import {describe, expect, it} from 'vitest';
import {AppError} from '@ontodecide/shared-kernel';
import type {RecStatus} from '../contract';
import {
  canTransition,
  isTerminal,
  REC_TRANSITIONS,
  transition,
} from './recommendation_state';

const ALL: RecStatus[] = [
  'Draft',
  'Proposed',
  'Approved',
  'Rejected',
  'Expired',
  'Executed',
  'ExecFailed',
  'Evaluated',
  'Failed',
];

const ALLOWED = new Set([
  'Draft>Proposed',
  'Draft>Failed',
  'Draft>Expired',
  'Proposed>Approved',
  'Proposed>Rejected',
  'Proposed>Expired',
  'Approved>Executed',
  'Approved>ExecFailed',
  'Executed>Evaluated',
]);

describe('recommendation state machine', () => {
  for (const from of ALL) {
    for (const to of ALL) {
      const ok = ALLOWED.has(`${from}>${to}`);
      it(`${from} → ${to} ${ok ? 'allowed' : 'rejected'}`, () => {
        expect(canTransition(from, to)).toBe(ok);
        if (ok) {
          expect(transition(from, to)).toBe(to);
        } else {
          let err: unknown;
          try {
            transition(from, to);
          } catch (e) {
            err = e;
          }
          expect(err).toBeInstanceOf(AppError);
          expect((err as AppError).code).toBe('INVALID_TRANSITION');
        }
      });
    }
  }

  it('marks terminal states', () => {
    expect(ALL.filter(isTerminal).sort()).toEqual([
      'Evaluated',
      'ExecFailed',
      'Expired',
      'Failed',
      'Rejected',
    ]);
    expect(Object.keys(REC_TRANSITIONS).sort()).toEqual([...ALL].sort());
  });
});
