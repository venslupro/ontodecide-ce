/**
 * @fileoverview Application errors and RFC 9457 Problem Details
 * (修订说明书 10.1, 详细设计 6.6).
 *
 * The error codes are the stable contract with the web app, which maps each
 * code to a localized message. Errors thrown across Workers RPC keep only
 * their message, so {@link AppError} encodes its payload into the message
 * and {@link AppError.from} decodes it on the caller side.
 */

/** Error codes and their default HTTP status. */
export const ERROR_STATUS = {
  VALIDATION_FAILED: 400,
  CODE_INVALID: 400,
  UNAUTHENTICATED: 401,
  TRIAL_EXPIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PRECONDITION_FAILED: 412,
  RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 429,
  INTERNAL: 500,
  UNAVAILABLE: 503,
  SIGNUP_CLOSED: 503,
} as const;

/** A known error code. */
export type ErrorCode = keyof typeof ERROR_STATUS;

/** Every error code, in declaration order (OpenAPI `Problem.code` enum). */
export const ERROR_CODES = Object.keys(ERROR_STATUS) as ErrorCode[];

/** RFC 9457 Problem Details body (`application/problem+json`). */
export interface Problem {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail?: string;
  traceId?: string;
  [extension: string]: unknown;
}

/** Media type of Problem Details responses. */
export const PROBLEM_MEDIA_TYPE = 'application/problem+json';

const MARKER = 'OD_ERR:';

/** Serializable payload of an {@link AppError}. */
interface AppErrorPayload {
  code: ErrorCode;
  detail?: string;
  status?: number;
  extras?: Record<string, unknown>;
}

/** Options of an {@link AppError}. */
export interface AppErrorOptions {
  /**
   * Overrides the default status, e.g. 422 for unmet action preconditions
   * or 413 for oversized bodies (both VALIDATION_FAILED).
   */
  status?: number;
  /** Extension members added to the Problem Details body. */
  extras?: Record<string, unknown>;
}

/** An application error with a stable code; safe to throw across RPC. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail?: string;
  readonly extras: Record<string, unknown>;

  constructor(code: ErrorCode, detail?: string, opts: AppErrorOptions = {}) {
    const payload: AppErrorPayload = {
      code,
      detail,
      status: opts.status,
      extras: opts.extras,
    };
    super(MARKER + JSON.stringify(payload));
    this.name = 'AppError';
    this.code = code;
    this.status = opts.status ?? ERROR_STATUS[code];
    this.detail = detail;
    this.extras = opts.extras ?? {};
  }

  /** Converts to Problem Details. */
  toProblem(traceId?: string): Problem {
    return {
      type: `about:blank#${this.code.toLowerCase()}`,
      title: this.code,
      status: this.status,
      code: this.code,
      ...(this.detail ? {detail: this.detail} : {}),
      ...(traceId ? {traceId} : {}),
      ...this.extras,
    };
  }

  /**
   * Recovers an AppError from anything thrown (including errors that
   * crossed an RPC boundary). Unknown errors become INTERNAL.
   */
  static from(err: unknown): AppError {
    if (err instanceof AppError) return err;
    const message = err instanceof Error ? err.message : String(err);
    const idx = message.indexOf(MARKER);
    if (idx >= 0) {
      try {
        const p = JSON.parse(
          message.slice(idx + MARKER.length),
        ) as AppErrorPayload;
        if (p.code in ERROR_STATUS) {
          return new AppError(p.code, p.detail, {
            status: p.status,
            extras: p.extras,
          });
        }
      } catch {
        // Not an encoded AppError; fall through.
      }
    }
    return new AppError('INTERNAL', message);
  }
}

/** Throws a NOT_FOUND error. */
export function notFound(detail?: string): never {
  throw new AppError('NOT_FOUND', detail);
}

/** Asserts a condition, throwing an AppError otherwise. */
export function ensure(
  cond: unknown,
  code: ErrorCode,
  detail?: string,
  opts?: AppErrorOptions,
): asserts cond {
  if (!cond) throw new AppError(code, detail, opts);
}
