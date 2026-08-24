/**
 * Date formatting utilities.
 *
 * Thin wrappers around dayjs so the rest of the application imports a single
 * helper rather than repeatedly configuring locale / timezone. New helpers
 * (e.g. date-only formatting) should be added here for consistency.
 */
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime.js';

dayjs.extend(relativeTime);

/**
 * Formats an ISO-8601 timestamp as a locale-aware date + time string.
 *
 * @param iso ISO-8601 string or {@code null}/{@code undefined} if unknown.
 * @returns Human-readable "YYYY-MM-DD HH:mm" timestamp, or an empty string
 *     when the input is falsy or unparseable.
 */
export function formatDateTime(iso?: string | null): string {
  if (!iso) return '';
  const parsed = dayjs(iso);
  if (!parsed.isValid()) return '';
  return parsed.format('YYYY-MM-DD HH:mm');
}

/**
 * Returns a relative-time string for an ISO-8601 timestamp relative to now.
 *
 * @param iso ISO-8601 string or {@code null}/{@code undefined} if unknown.
 * @returns Relative string like "2 hours ago", or an empty string when the
 *     input is missing / invalid.
 */
export function formatRelative(iso?: string | null): string {
  if (!iso) return '';
  const parsed = dayjs(iso);
  if (!parsed.isValid()) return '';
  return parsed.fromNow();
}
