/**
 * @fileoverview Cursor pagination (修订说明书 10.1: `?cursor=&limit=`,
 * limit ≤ 100, response `nextCursor`).
 */

/** Page request (opaque cursor). */
export interface PageRequest {
  cursor?: string;
  limit?: number;
}

/** Page of results. */
export interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
}

/** Default page size. */
export const PAGE_LIMIT_DEFAULT = 50;

/** Largest page size. */
export const PAGE_LIMIT_MAX = 100;

/** Clamps a requested page size into [1, PAGE_LIMIT_MAX]. */
export function clampLimit(limit?: number): number {
  if (!limit || !Number.isFinite(limit)) return PAGE_LIMIT_DEFAULT;
  return Math.min(PAGE_LIMIT_MAX, Math.max(1, Math.floor(limit)));
}

/** Encodes a cursor. */
export function encodeCursor(value: Record<string, unknown>): string {
  return btoa(JSON.stringify(value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Decodes a cursor produced by {@link encodeCursor}; null if invalid. */
export function decodeCursor<T = Record<string, unknown>>(
  cursor?: string | null,
): T | null {
  if (!cursor) return null;
  try {
    const b64 = cursor.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64)) as T;
  } catch {
    return null;
  }
}
