/**
 * @fileoverview Tests of the shared kernel: call context, ids, errors, HTTP, paging, quotas, tenant scoping.
 */

import {describe, expect, it} from 'vitest';
import {
  actorLabel,
  decodeCtx,
  encodeCtx,
  isServiceCtx,
  serviceCtx,
} from './call_ctx';
import {AppError, ERROR_CODES, ERROR_STATUS} from './errors';
import {parseEtag, toEtag, isIdempotencyKey} from './http';
import {isRid, isUlid, newRid, parseRid, ulid} from './ids';
import {resolveText} from './i18n';
import {clampLimit, decodeCursor, encodeCursor} from './page';
import {backoffSeconds, baseQueueName} from './queue';
import {mergeQuotas, nextUtcMidnight} from './quota';
import {isTenantScoped} from './d1/tenant_repository';

describe('call context', () => {
  it('builds service contexts and audit labels', () => {
    const ctx = serviceCtx('T1', 'decision-engine');
    expect(ctx).toMatchObject({tid: 'T1', sub: 'svc:decision-engine'});
    expect(isServiceCtx(ctx)).toBe(true);
    expect(actorLabel(ctx)).toBe('svc:decision-engine');
    expect(actorLabel({...ctx, actor: {role: 'admin', actingAs: true}})).toBe(
      'admin',
    );
  });

  it('round-trips through the ctx header including non-ASCII', () => {
    const ctx = {...serviceCtx('t1', 'x'), requestId: '请求'};
    expect(decodeCtx(encodeCtx(ctx))).toEqual(ctx);
  });
});

describe('ids', () => {
  it('generates sortable ULIDs and parses RIDs', () => {
    const a = ulid(1000);
    const b = ulid(2000);
    expect(a).toHaveLength(26);
    expect(isUlid(a)).toBe(true);
    expect(a < b).toBe(true);
    const rid = newRid('Supplier');
    expect(parseRid(rid)).toMatchObject({objectType: 'Supplier'});
    expect(isRid('ri.a')).toBe(false);
    expect(isRid('ri.a.b.c')).toBe(false);
    expect(isRid(rid)).toBe(true);
  });
});

describe('errors', () => {
  it('survives an RPC boundary with status overrides', () => {
    const e = new AppError('VALIDATION_FAILED', 'precondition', {
      status: 422,
      extras: {unmet: ['x']},
    });
    const back = AppError.from(new Error(e.message));
    expect(back.status).toBe(422);
    expect(back.toProblem('tr1')).toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 422,
      traceId: 'tr1',
      unmet: ['x'],
    });
    expect(AppError.from(new Error('boom')).code).toBe('INTERNAL');
  });

  it('lists every code with a status', () => {
    expect(ERROR_CODES).toContain('TRIAL_EXPIRED');
    expect(ERROR_STATUS.SIGNUP_CLOSED).toBe(503);
    expect(ERROR_STATUS.PRECONDITION_FAILED).toBe(412);
  });
});

describe('http helpers', () => {
  it('formats and parses ETags', () => {
    expect(toEtag(3)).toBe('"v3"');
    expect(parseEtag('"v3"')).toBe(3);
    expect(parseEtag('W/"v12"')).toBe(12);
    expect(parseEtag('7')).toBe(7);
    expect(parseEtag('nope')).toBeNull();
    expect(isIdempotencyKey('0192f0c4-7a7b-7c1d')).toBe(true);
    expect(isIdempotencyKey('short')).toBe(false);
  });
});

describe('paging, queues and quotas', () => {
  it('clamps limits and round-trips cursors', () => {
    expect(clampLimit(undefined)).toBe(50);
    expect(clampLimit(500)).toBe(100);
    const c = encodeCursor({k: 'a/b+c'});
    expect(decodeCursor(c)).toEqual({k: 'a/b+c'});
    expect(decodeCursor('%%%')).toBeNull();
  });

  it('maps deployed queue names and backs off', () => {
    expect(baseQueueName('ontodecide-prd-domain-events')).toBe('domain-events');
    expect(baseQueueName('ontodecide-prd-dead-letter')).toBe('dead-letter');
    expect(backoffSeconds(1)).toBe(2);
    expect(backoffSeconds(10)).toBe(60);
  });

  it('merges quotas', () => {
    const now = new Date('2026-09-28T10:00:00Z');
    expect(nextUtcMidnight(now)).toBe('2026-09-29T00:00:00.000Z');
    const q = mergeQuotas([{key: 'objects', used: 3, limit: 300}], now);
    expect(q.objects).toEqual({used: 3, limit: 300});
    expect(q.links).toEqual({used: 0, limit: 0});
  });

  it('resolves localized text', () => {
    expect(resolveText({'zh-CN': '中', 'en-US': 'en'}, 'en-US')).toBe('en');
    expect(resolveText({'zh-CN': '中'}, 'en-US')).toBe('中');
  });
});

describe('tenant scoping', () => {
  it('accepts only SQL bound to the workspace', () => {
    expect(isTenantScoped('SELECT * FROM t WHERE tenant_id = ?1')).toBe(true);
    expect(
      isTenantScoped('INSERT INTO og_object (tenant_id, rid) VALUES (?1, ?2)'),
    ).toBe(true);
    expect(isTenantScoped('SELECT * FROM t WHERE tenant_id = ?2')).toBe(false);
    expect(isTenantScoped('DELETE FROM t')).toBe(false);
  });
});
