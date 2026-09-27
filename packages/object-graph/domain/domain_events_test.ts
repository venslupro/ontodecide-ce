/**
 * @fileoverview Tests of domain event splitting (≤ 64 KB per message).
 */

import {describe, expect, it} from 'vitest';
import {jsonBytes} from '@ontodecide/shared-kernel';
import type {DomainEventMsg, Rid} from '@ontodecide/shared-kernel';
import {splitEvent} from './domain_events';

function event(n: number): DomainEventMsg {
  return {
    eventId: '01K6A00000000000000000EVT1',
    tid: '01K6A000000000000000000T01',
    occurredAt: 1,
    kind: 'ObjectsUpserted',
    jobId: 'job',
    changes: Array.from({length: n}, (_, i) => ({
      rid: `ri.Supplier.${String(i).padStart(26, '0')}` as Rid,
      type: 'Supplier',
      changed: ['name', 'country', 'riskScore', 'tier', 'status'],
    })),
  };
}

describe('splitEvent', () => {
  it('keeps small events whole', () => {
    const e = event(3);
    expect(splitEvent(e)).toEqual([e]);
  });

  it('splits by rid into bounded messages with distinct ids', () => {
    const e = event(1000);
    expect(jsonBytes(e)).toBeGreaterThan(64 * 1024);
    const parts = splitEvent(e);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(jsonBytes(p)).toBeLessThanOrEqual(64 * 1024);
      expect(p).toMatchObject({tid: e.tid, kind: e.kind, jobId: 'job'});
    }
    expect(parts.flatMap(p => p.changes)).toEqual(e.changes);
    expect(parts.map(p => p.eventId)).toEqual(
      parts.map((_, i) => `${e.eventId}#${i + 1}`),
    );
  });
});
