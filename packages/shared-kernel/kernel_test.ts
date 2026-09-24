import {describe, expect, it, vi} from 'vitest';
import {decodeCtx, encodeCtx, hasMarking, hasRole, systemCtx} from './call_ctx';
import {AppError, ERROR_STATUS} from './errors';
import {isRid, newRid, parseRid, ulid} from './ids';
import {resolveText} from './i18n';
import {backoffSeconds, baseQueueName} from './queue';
import {usageLevel} from './usage';
import {UsageMeter} from './usage_meter';

describe('call context', () => {
  it('orders roles and checks markings', () => {
    expect(hasRole(['Operator'], 'Viewer')).toBe(true);
    expect(hasRole(['Operator'], 'Modeler')).toBe(false);
    expect(hasRole(['Admin'], 'Modeler')).toBe(true);
    const sys = systemCtx('t1');
    expect(hasMarking(sys, 'PII')).toBe(true);
    expect(hasMarking({...sys, markings: ['FINANCE']}, 'PII')).toBe(false);
  });

  it('round-trips through the ctx header including non-ASCII', () => {
    const ctx = {...systemCtx('t1'), locale: 'zh-CN', userId: '用户'};
    expect(decodeCtx(encodeCtx(ctx))).toEqual(ctx);
  });
});

describe('ids', () => {
  it('generates sortable ULIDs and parses RIDs', () => {
    const a = ulid(1000);
    const b = ulid(2000);
    expect(a).toHaveLength(26);
    expect(a < b).toBe(true);
    const rid = newRid('t1', 'Supplier');
    expect(parseRid(rid)).toMatchObject({
      tenantId: 't1',
      objectType: 'Supplier',
    });
    expect(isRid('ri.a.b')).toBe(false);
    expect(isRid(rid)).toBe(true);
  });
});

describe('AppError', () => {
  it('maps codes to statuses and survives message-only transport', () => {
    const err = new AppError('VERSION_CONFLICT', 'stale', {current: 3});
    expect(err.status).toBe(412);
    const back = AppError.from(new Error(err.message));
    expect(back).toMatchObject({
      code: 'VERSION_CONFLICT',
      detail: 'stale',
      extras: {current: 3},
    });
    expect(back.toProblem('r1')).toMatchObject({
      status: 412,
      code: 'VERSION_CONFLICT',
      requestId: 'r1',
      current: 3,
    });
    expect(AppError.from(new Error('boom')).code).toBe('INTERNAL');
    expect(Object.values(ERROR_STATUS).every(s => s >= 400 && s < 600)).toBe(
      true,
    );
  });
});

describe('misc helpers', () => {
  it('resolves i18n text with fallbacks', () => {
    expect(resolveText({'zh-CN': '供应商', 'en-US': 'Supplier'}, 'en-US')).toBe(
      'Supplier',
    );
    expect(resolveText({'zh-CN': '供应商'}, 'en-US')).toBe('供应商');
    expect(resolveText('plain', 'en-US')).toBe('plain');
    expect(resolveText(undefined, 'en-US', 'fb')).toBe('fb');
  });

  it('normalizes queue names and backs off exponentially', () => {
    expect(baseQueueName('object-writes-dlq-staging')).toEqual({
      name: 'object-writes',
      dlq: true,
    });
    expect(baseQueueName('ingest')).toEqual({name: 'ingest', dlq: false});
    expect([1, 2, 3, 10].map(backoffSeconds)).toEqual([2, 4, 8, 60]);
  });

  it('computes usage levels', () => {
    expect(usageLevel(0.5)).toBe('ok');
    expect(usageLevel(0.8)).toBe('warn');
    expect(usageLevel(0.95)).toBe('stop');
  });

  it('batches usage reports every N events', async () => {
    const reporter = vi.fn(async () => undefined);
    let now = 0;
    const meter = new UsageMeter(reporter, 3, 30_000, () => now);
    void meter.record('workers.requests');
    void meter.record('workers.requests', 2);
    expect(reporter).not.toHaveBeenCalled();
    await meter.record('ai.neurons', 76);
    expect(reporter).toHaveBeenCalledWith([
      {resource: 'workers.requests', n: 3},
      {resource: 'ai.neurons', n: 76},
    ]);
    now = 31_000;
    await meter.record('kv.writes');
    expect(reporter).toHaveBeenCalledTimes(2);
  });
});
