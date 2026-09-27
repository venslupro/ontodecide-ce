/**
 * @fileoverview Tests of alert dedupe, cooldown and auto-close decisions.
 */

import {describe, expect, it} from 'vitest';
import {decideAlert, severityRank} from './alert_policy';

const NOW = 1_000_000_000;

describe('decideAlert', () => {
  const open = {id: 'a1', status: 'OPEN' as const, closedAt: null};
  const acked = {id: 'a1', status: 'ACKED' as const, closedAt: null};
  const closed = (ago: number) => ({
    id: 'a0',
    status: 'CLOSED' as const,
    closedAt: NOW - ago,
  });
  const base = {active: null, lastClosed: null, cooldownSec: 60, now: NOW};

  it('raises when nothing is active', () => {
    expect(decideAlert({...base, matches: true})).toEqual({kind: 'raise'});
  });

  it('dedupes: a hit on an active alert updates it', () => {
    expect(decideAlert({...base, matches: true, active: open})).toEqual({
      kind: 'hit',
      alertId: 'a1',
    });
    expect(decideAlert({...base, matches: true, active: acked})).toEqual({
      kind: 'hit',
      alertId: 'a1',
    });
  });

  it('cools down: a hit shortly after closing updates the closed alert', () => {
    expect(
      decideAlert({...base, matches: true, lastClosed: closed(59_000)}),
    ).toEqual({kind: 'cooldown', alertId: 'a0'});
    expect(
      decideAlert({...base, matches: true, lastClosed: closed(60_000)}),
    ).toEqual({kind: 'raise'});
    expect(
      decideAlert({
        ...base,
        cooldownSec: 0,
        matches: true,
        lastClosed: closed(1),
      }),
    ).toEqual({kind: 'raise'});
  });

  it('auto-closes when the condition stops holding', () => {
    expect(decideAlert({...base, matches: false, active: open})).toEqual({
      kind: 'close',
      alertId: 'a1',
    });
    expect(decideAlert({...base, matches: false, active: acked})).toEqual({
      kind: 'close',
      alertId: 'a1',
    });
    expect(decideAlert({...base, matches: false})).toEqual({kind: 'none'});
  });
});

describe('severityRank', () => {
  it('orders severities', () => {
    expect(severityRank('CRITICAL')).toBeGreaterThan(severityRank('HIGH'));
    expect(severityRank('HIGH')).toBeGreaterThan(severityRank('MEDIUM'));
    expect(severityRank('MEDIUM')).toBeGreaterThan(severityRank('LOW'));
  });
});
