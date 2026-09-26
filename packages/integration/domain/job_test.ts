/**
 * @fileoverview Tests for the job state machine and completion rule.
 */

import {describe, expect, it} from 'vitest';
import {
  assertTransition,
  canTransition,
  finalStatus,
  isJobComplete,
  isTerminal,
  qualityScore,
} from './job';

const base = {
  received: 10,
  rejected: 0,
  lastSeq: 1,
  batches: 2,
  ingestTotal: 3,
  ingestDone: 3,
  totalGroups: 3,
  doneGroups: 3,
};

describe('job', () => {
  it('transitions', () => {
    expect(canTransition('Queued', 'Running')).toBe(true);
    expect(canTransition('Running', 'Succeeded')).toBe(true);
    expect(canTransition('Succeeded', 'Running')).toBe(false);
    expect(isTerminal('PartiallyFailed')).toBe(true);
    expect(() => assertTransition('Failed', 'Running')).toThrow(
      /INVALID_TRANSITION/,
    );
  });

  it('completion needs last batch, all batches, messages and groups', () => {
    expect(isJobComplete(base)).toBe(true);
    expect(isJobComplete({...base, lastSeq: null})).toBe(false);
    expect(isJobComplete({...base, batches: 1})).toBe(false);
    expect(isJobComplete({...base, ingestDone: 2})).toBe(false);
    expect(isJobComplete({...base, doneGroups: 2})).toBe(false);
  });

  it('final status and quality score', () => {
    expect(finalStatus({received: 10, rejected: 0})).toBe('Succeeded');
    expect(finalStatus({received: 10, rejected: 3})).toBe('PartiallyFailed');
    expect(finalStatus({received: 10, rejected: 10})).toBe('Failed');
    expect(qualityScore(10, 3)).toBe(0.7);
    expect(qualityScore(0, 0)).toBe(1);
  });
});
