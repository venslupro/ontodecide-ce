/**
 * Shared Hono + OpenAPI helpers used across all OntoDecide Workers.
 *
 * These utilities standardise:
 *  - The OpenAPI response objects for success/error envelopes.
 *  - A global error handler that translates thrown ApiErrorImpl values
 *    into the standard {@link ApiResponse} shape.
 *  - A typed `Content` helper for `@hono/zod-openapi` route definitions.
 */
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { apiErrorSchema, apiResponseSchema } from '../schemas/index.js';
import { ERROR_CODES, STATUS_BY_CODE } from '../constants/errors.js';
import { HEADERS } from '../constants/headers.js';
import { ApiErrorImpl } from '../utils/response.js';
import type { ApiResponse } from '../types/common.js';

/**
 * Build a standard OpenAPI JSON response object for `@hono/zod-openapi`
 * route definitions.
 *
 * Usage:
 * ```ts
 * responses: {
 *   200: jsonOk(authTokensSchema, 'Tokens issued successfully.'),
 *   400: jsonError('Validation failed.'),
 * }
 * ```
 */
export function jsonOk<T extends z.ZodTypeAny>(
  schema: T,
  description: string,
): {
  content: { 'application/json': { schema: z.ZodTypeAny } };
  description: string;
} {
  return {
    description,
    content: {
      'application/json': {
        schema: apiResponseSchema(schema),
      },
    },
  };
}

/**
 * Build a standard OpenAPI error response object.
 */
export function jsonError(description: string): {
  content: { 'application/json': { schema: z.ZodTypeAny } };
  description: string;
} {
  return {
    description,
    content: {
      'application/json': {
        schema: apiResponseSchema(apiErrorSchema),
      },
    },
  };
}

/**
 * Global Hono error handler.
 *
 * Translates thrown {@link ApiErrorImpl} instances (and any other errors)
 * into the standard {@link ApiResponse} JSON envelope with the correct HTTP
 * status code derived from {@link STATUS_BY_CODE}.
 */
export function honoErrorHandler(err: unknown, c: Context): Response {
  const traceId = c.req.header(HEADERS.TRACE_ID) ?? 'no-trace';
  if (err instanceof ApiErrorImpl) {
    const status = (STATUS_BY_CODE[err.code] ?? 500) as ContentfulStatusCode;
    const body: ApiResponse<never> = {
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
      traceId,
    };
    return c.json(body, status);
  }
  const message = err instanceof Error ? err.message : 'Unexpected error.';
  const body: ApiResponse<never> = {
    success: false,
    error: {
      code: ERROR_CODES.INTERNAL,
      message,
    },
    traceId,
  };
  return c.json(body, 500);
}

/**
 * Build a success JSON response with the standard envelope.
 */
export function jsonOkResponse<T>(c: Context, data: T, traceId?: string): Response {
  const body: ApiResponse<T> = {
    success: true,
    data,
    traceId: traceId ?? c.req.header(HEADERS.TRACE_ID) ?? undefined,
  };
  return c.json(body);
}

/**
 * Build an error JSON response with the standard envelope.
 */
export function jsonFailResponse(
  c: Context,
  code: string,
  message: string,
  status?: number,
): Response {
  const httpStatus = (status ?? STATUS_BY_CODE[code] ?? 500) as ContentfulStatusCode;
  const traceId = c.req.header(HEADERS.TRACE_ID) ?? undefined;
  const body: ApiResponse<never> = {
    success: false,
    error: { code, message },
    traceId,
  };
  return c.json(body, httpStatus);
}

/**
 * Extract identity headers injected by the Gateway.
 */
export function getAuthContext(c: Context): {
  userId: string;
  tenantId: string;
  role: string;
  traceId: string;
  ip: string | null;
  userAgent: string | null;
} {
  return {
    userId: c.req.header(HEADERS.USER_ID) ?? 'anon',
    tenantId: c.req.header(HEADERS.TENANT_ID) ?? 'tenant_anon',
    role: c.req.header(HEADERS.USER_ROLE) ?? 'viewer',
    traceId: c.req.header(HEADERS.TRACE_ID) ?? 'no-trace',
    ip: c.req.header('cf-connecting-ip') ?? null,
    userAgent: c.req.header('user-agent') ?? null,
  };
}

/**
 * Middleware that rejects requests not coming from the Gateway
 * (identified by the `x-internal-call: 1` header).
 *
 * The `allowedPaths` parameter lets public routes (e.g. `/auth/login`)
 * bypass the check.
 */
export function internalOnlyMiddleware(allowedPaths: string[] = []) {
  return async (c: Context, next: () => Promise<void>): Promise<Response | void> => {
    if (c.req.header(HEADERS.INTERNAL) !== '1') {
      const path = new URL(c.req.url).pathname;
      if (!allowedPaths.some((p) => path.startsWith(p))) {
        return jsonFailResponse(
          c,
          ERROR_CODES.AUTH_FORBIDDEN,
          'Direct access is not allowed.',
          403,
        );
      }
    }
    await next();
  };
}

export { OpenAPIHono, createRoute };
