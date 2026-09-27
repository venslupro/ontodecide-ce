/**
 * @fileoverview Local error reporting. CE has no telemetry endpoint and no
 * third-party analytics (前端详细设计 6.5): errors get a short id shown in
 * the error view (with the API traceId, if any) and are logged to the
 * console only, so users can quote the id when reporting a problem.
 */

/** Generates a short error id shown to users. */
export function newErrorId(): string {
  return (
    Math.random().toString(36).slice(2, 8).toUpperCase() +
    Date.now().toString(36).slice(-4).toUpperCase()
  );
}

/** Logs an error locally and returns its id (no network). */
export function reportError(
  err: unknown,
  extra: {traceId?: string; errorId?: string} = {},
): string {
  const errorId = extra.errorId ?? newErrorId();
  if (typeof console !== 'undefined') {
    console.error(`[${errorId}]`, extra.traceId ?? '', err);
  }
  return errorId;
}
