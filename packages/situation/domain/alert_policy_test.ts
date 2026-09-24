/**
 * @fileoverview Table-driven tests for alert de-duplication and cooldown.
 */

import {describe, expect, it} from 'vitest';
import {
  type AlertDecision,
  type LatestAlert,
  canTransition,
  decideAlert,
} from './alert_policy';

const NOW = 1_000_000_000;

describe('decideAlert', () => {
  const cases: [string, LatestAlert | null, number, AlertDecision][] = [
    ['no previous alert', null, 3600, {kind: 'create'}],
    [
      'OPEN alert',
      {id: 'x', status: 'OPEN'},
      3600,
      {kind: 'update', alertId: 'x', reason: 'active'},
    ],
    [
      'ACKED alert',
      {id: 'x', status: 'ACKED'},
      3600,
      {kind: 'update', alertId: 'x', reason: 'active'},
    ],
    [
      'CLOSED within cooldown',
      {id: 'x', status: 'CLOSED', closedAt: NOW - 3599_000},
      3600,
      {kind: 'update', alertId: 'x', reason: 'cooldown'},
    ],
    [
      'CLOSED exactly at cooldown end',
      {id: 'x', status: 'CLOSED', closedAt: NOW - 3600_000},
      3600,
      {kind: 'create'},
    ],
    [
      'CLOSED after cooldown',
      {id: 'x', status: 'CLOSED', closedAt: NOW - 7200_000},
      3600,
      {kind: 'create'},
    ],
    [
      'CLOSED with zero cooldown',
      {id: 'x', status: 'CLOSED', closedAt: NOW},
      0,
      {kind: 'create'},
    ],
  ];

  it.each(cases)('%s', (_name, latest, cooldown, expected) => {
    expect(decideAlert(latest, NOW, cooldown)).toEqual(expected);
  });
});

describe('canTransition', () => {
  it.each([
    ['OPEN', 'ACKED', true],
    ['OPEN', 'CLOSED', true],
    ['ACKED', 'CLOSED', true],
    ['ACKED', 'ACKED', true],
    ['ACKED', 'OPEN', false],
    ['CLOSED', 'ACKED', false],
    ['CLOSED', 'CLOSED', false],
  ] as const)('%s → %s = %s', (from, to, ok) => {
    expect(canTransition(from, to)).toBe(ok);
  });
});
