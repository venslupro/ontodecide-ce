/**
 * Date and time helpers.
 */

/** ISO 8601 timestamp for "now". */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Epoch seconds for "now". */
export function nowEpochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Days between two ISO timestamps.
 * @returns Positive number of days, or 0 if `to` is in the past.
 */
export function daysSince(fromIso: string | null | undefined, toIso = nowIso()): number {
  if (!fromIso) return 0;
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return 0;
  return Math.floor((to - from) / 86_400_000);
}

/** Add days to an ISO timestamp and return the new ISO string. */
export function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/** Format a Date for KV keys like `neuron:2026-08-20`. */
export function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}
