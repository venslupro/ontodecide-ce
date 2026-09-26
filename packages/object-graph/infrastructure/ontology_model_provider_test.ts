import {describe, expect, it} from 'vitest';
import type {CompiledModel} from '@ontodecide/ontology/contract';
import {FixedClock} from '@ontodecide/shared-kernel';
import {testCtx} from '@ontodecide/testing';
import {OntologyModelProvider} from './ontology_model_provider';

describe('OntologyModelProvider', () => {
  it('caches by version for writes and by TTL for reads', async () => {
    let version = '1.0.0';
    let calls = 0;
    const clock = new FixedClock();
    const provider = new OntologyModelProvider(
      {
        getActiveModel: async () => {
          calls++;
          return {version} as CompiledModel;
        },
      },
      clock,
    );
    const ctx = testCtx();
    await provider.get(ctx);
    await provider.get(ctx);
    expect(calls).toBe(1);
    await provider.get(ctx, {expectedVersion: '1.0.0'});
    expect(calls).toBe(1);
    version = '1.1.0';
    expect((await provider.get(ctx, {expectedVersion: '1.1.0'})).version).toBe(
      '1.1.0',
    );
    expect(calls).toBe(2);
    // An unmatched producer version is fetched once, then accepted.
    await provider.get(ctx, {expectedVersion: 'schema-9'});
    await provider.get(ctx, {expectedVersion: 'schema-9'});
    expect(calls).toBe(3);
    clock.advance(61_000);
    await provider.get(ctx);
    expect(calls).toBe(4);
    await provider.get(ctx, {refresh: true});
    expect(calls).toBe(5);
  });
});
