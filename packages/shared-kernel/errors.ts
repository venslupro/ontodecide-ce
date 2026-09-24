/**
 * @fileoverview Application errors and RFC 9457 Problem Details.
 *
 * Errors thrown across Workers RPC lose custom properties and keep only the
 * message, so {@link AppError} encodes its payload into the message and
 * {@link AppError.from} decodes it on the caller side.
 */

/** Error codes and their HTTP status. */
export const ERROR_STATUS = {
  VALIDATION_FAILED: 400,
  PERTURBATION_INVALID: 400,
  OBJECT_SET_INVALID: 400,
  AUTH_INVALID: 401,
  AUTH_EXPIRED: 401,
  SIGNATURE_INVALID: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  OBJECT_NOT_FOUND: 404,
  SOURCE_NOT_FOUND: 404,
  CONFLICT: 409,
  APPROVAL_REQUIRED: 409,
  INVALID_TRANSITION: 409,
  REPLAY: 409,
  VERSION_CONFLICT: 412,
  BATCH_TOO_LARGE: 413,
  PRECONDITION_FAILED: 422,
  ONTOLOGY_BREAKING_CHANGE: 422,
  ONTOLOGY_INVALID: 422,
  GRAPH_TOO_LARGE: 422,
  AUTH_LOCKED: 423,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  UPSTREAM_FAILED: 502,
  QUOTA_EXCEEDED: 503,
} as const;

/** A known error code. */
export type ErrorCode = keyof typeof ERROR_STATUS;

/** RFC 9457 Problem Details body. */
export interface Problem {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail?: string;
  requestId?: string;
  [extension: string]: unknown;
}

const MARKER = 'OD_ERR:';

/** Serializable payload of an {@link AppError}. */
interface AppErrorPayload {
  code: ErrorCode;
  detail?: string;
  extras?: Record<string, unknown>;
}

/** An application error with a stable code; safe to throw across RPC. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail?: string;
  readonly extras: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    detail?: string,
    extras: Record<string, unknown> = {},
  ) {
    const payload: AppErrorPayload = {code, detail, extras};
    super(MARKER + JSON.stringify(payload));
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.detail = detail;
    this.extras = extras;
  }

  /** Converts to Problem Details. */
  toProblem(requestId?: string): Problem {
    return {
      type: `https://ontodecide-ce.pages.dev/problems/${this.code.toLowerCase()}`,
      title: this.code,
      status: this.status,
      code: this.code,
      ...(this.detail ? {detail: this.detail} : {}),
      ...(requestId ? {requestId} : {}),
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
        if (p.code in ERROR_STATUS)
          return new AppError(p.code, p.detail, p.extras ?? {});
      } catch {
        // fall through
      }
    }
    return new AppError('INTERNAL', message);
  }
}

/** Throws NOT_FOUND-style errors concisely. */
export function notFound(
  code: ErrorCode = 'NOT_FOUND',
  detail?: string,
): never {
  throw new AppError(code, detail);
}

/** Asserts a condition, throwing an AppError otherwise. */
export function ensure(
  cond: unknown,
  code: ErrorCode,
  detail?: string,
): asserts cond {
  if (!cond) throw new AppError(code, detail);
}
