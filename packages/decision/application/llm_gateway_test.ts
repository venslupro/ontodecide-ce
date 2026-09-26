/**
 * @fileoverview Tests for the LLM gateway: cache, quotas and usage.
 */

import {describe, expect, it} from 'vitest';
import {
  FixedClock,
  HOUR_MS,
  silentLogger,
  systemCtx,
} from '@ontodecide/shared-kernel';
import {createTestD1, testCtx} from '@ontodecide/testing';
import {D1LlmStore} from '../infrastructure/d1_llm_store';
import {FakeLlm} from '../infrastructure/llm/fake_llm';
import {LlmProviderError} from '../infrastructure/llm/llm_error';
import {LlmGateway} from './llm_gateway';

const P = {system: 's', user: 'u'};

function setup(
  limits = {user: 20, tenant: 50},
  llm: FakeLlm | null = new FakeLlm({replies: ['{"a":1}']}),
) {
  const clock = new FixedClock('2026-09-24T08:00:00Z');
  const store = new D1LlmStore(createTestD1('decision'));
  return {
    clock,
    store,
    llm,
    gw: new LlmGateway(llm, store, clock, limits, silentLogger),
  };
}

describe('LlmGateway', () => {
  it('serves repeated prompts from the cache for one hour', async () => {
    const {gw, llm, clock} = setup();
    const ctx = testCtx({role: 'Operator'});
    const a = await gw.complete(ctx, P);
    const b = await gw.complete(ctx, P);
    expect(a).toMatchObject({
      status: 'ok',
      cached: false,
      neurons: 76,
      model: 'fake-llm',
    });
    expect(b).toMatchObject({
      status: 'ok',
      cached: true,
      neurons: 0,
      text: '{"a":1}',
    });
    expect(llm!.calls).toHaveLength(1);
    clock.advance(HOUR_MS + 1);
    expect(await gw.complete(ctx, P)).toMatchObject({cached: false});
    expect(llm!.calls).toHaveLength(2);
    expect(await gw.purge(clock.now())).toBe(0);
    clock.advance(HOUR_MS + 1);
    expect(await gw.purge(clock.now())).toBe(1);
  });

  it('does not cache rejected output', async () => {
    const {gw, llm} = setup();
    const ctx = testCtx();
    await gw.complete(ctx, P, {accept: () => false});
    await gw.complete(ctx, P, {accept: () => false});
    expect(llm!.calls).toHaveLength(2);
  });

  it('enforces the per-user daily limit and reports remaining quota', async () => {
    const {gw, llm} = setup({user: 2, tenant: 50});
    const ctx = testCtx({role: 'Operator'});
    await gw.complete(ctx, {system: 's', user: '1'});
    expect(await gw.quota(ctx)).toEqual({
      userRemaining: 1,
      tenantRemaining: 49,
    });
    await gw.complete(ctx, {system: 's', user: '2'});
    expect(await gw.complete(ctx, {system: 's', user: '3'})).toEqual({
      status: 'skipped',
      reason: 'quota',
    });
    expect(llm!.calls).toHaveLength(2);
    // Another user of the same tenant still has quota.
    expect(
      (await gw.complete(testCtx({userId: 'u2'}), {system: 's', user: '4'}))
        .status,
    ).toBe('ok');
  });

  it('enforces the per-tenant limit (system calls count only per tenant)', async () => {
    const {gw} = setup({user: 1, tenant: 2});
    const sys = systemCtx('t1');
    await gw.complete(sys, {system: 's', user: '1'});
    await gw.complete(sys, {system: 's', user: '2'});
    expect(await gw.quota(sys)).toEqual({userRemaining: 0, tenantRemaining: 0});
    expect(
      (await gw.complete(testCtx(), {system: 's', user: '3'})).status,
    ).toBe('skipped');
  });

  it('reports unavailable and provider failures as skipped', async () => {
    expect(await setup(undefined, null).gw.complete(testCtx(), P)).toEqual({
      status: 'skipped',
      reason: 'unavailable',
    });
    const {gw} = setup(
      undefined,
      new FakeLlm({replies: [new LlmProviderError('down', true, 503)]}),
    );
    expect(await gw.complete(testCtx(), P)).toMatchObject({
      status: 'skipped',
      reason: 'failed',
    });
  });
});
