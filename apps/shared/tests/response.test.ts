/**
 * Unit tests for shared response envelope helpers.
 */
import { describe, it, expect } from 'vitest';
import { ok, fail, throwError, ApiErrorImpl, toApiError } from '../src/utils/response.js';

describe('ok', () => {
  it('builds a success envelope with data', () => {
    const result = ok({ id: 1 }, 'trace-123');
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: 1 });
    expect(result.traceId).toBe('trace-123');
  });

  it('builds a success envelope without traceId', () => {
    const result = ok('hello');
    expect(result.success).toBe(true);
    expect(result.data).toBe('hello');
    expect(result.traceId).toBeUndefined();
  });
});

describe('fail', () => {
  it('builds an error envelope with code and message', () => {
    const result = fail('NOT_FOUND', 'Resource not found.');
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe('NOT_FOUND');
    expect(result.error!.message).toBe('Resource not found.');
    expect(result.error!.details).toBeUndefined();
  });

  it('includes details when provided', () => {
    const result = fail('VALIDATION_FAILED', 'Invalid input.', {
      field: 'username',
      reason: 'too short',
    });
    expect(result.error!.details).toEqual({
      field: 'username',
      reason: 'too short',
    });
  });
});

describe('throwError', () => {
  it('throws an ApiErrorImpl with the given code and message', () => {
    expect(() => throwError('AUTH_FORBIDDEN', 'No access.')).toThrow(ApiErrorImpl);
    try {
      throwError('AUTH_FORBIDDEN', 'No access.');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiErrorImpl);
      expect((err as ApiErrorImpl).code).toBe('AUTH_FORBIDDEN');
      expect((err as ApiErrorImpl).message).toBe('No access.');
    }
  });
});

describe('toApiError', () => {
  it('returns the same ApiErrorImpl instance when given one', () => {
    const original = new ApiErrorImpl('CUSTOM', 'Custom error.');
    const result = toApiError(original);
    expect(result).toBe(original);
  });

  it('wraps a generic Error into an ApiError', () => {
    const result = toApiError(new Error('Something broke.'));
    expect(result.code).toBe('INTERNAL');
    expect(result.message).toBe('Something broke.');
  });

  it('wraps a non-Error value', () => {
    const result = toApiError('oops');
    expect(result.code).toBe('INTERNAL');
    expect(result.message).toBe('Internal error');
  });
});
