/**
 * Common types shared across all OntoDecide services.
 */

/** Standard API response envelope returned by every Worker. */
export interface ApiResponse<T = unknown> {
  /** Whether the request succeeded. */
  success: boolean;
  /** Response payload on success. */
  data?: T;
  /** Error details on failure. */
  error?: ApiError;
  /** Server-side trace id, useful for debugging. */
  traceId?: string;
}

/** Normalized error payload. */
export interface ApiError {
  /** Stable error code, e.g. 'AUTH_INVALID_CREDENTIALS'. */
  code: string;
  /** Human-readable message in the user's locale. */
  message: string;
  /** Optional field-level validation details. */
  details?: Record<string, string>;
}

/** Paginated list response. */
export interface PaginatedResponse<T> {
  /** Total number of records matching the query. */
  total: number;
  /** Current page number (1-based). */
  page: number;
  /** Page size used for the query. */
  size: number;
  /** Records on the current page. */
  list: T[];
}

/** Pagination query parameters. */
export interface PageQuery {
  page?: number;
  size?: number;
}

/** Standard service result wrapping either a value or an error. */
export type Result<T, E = ApiError> =
  | {ok: true; value: T}
  | {ok: false; error: E};
