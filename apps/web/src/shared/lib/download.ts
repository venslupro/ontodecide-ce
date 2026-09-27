/**
 * @fileoverview Browser file saving helpers (no network): Blob → `<a
 * download>`, and top-level navigation for presigned links (admin archive
 * download; not a fetch, so CSP `connect-src 'self'` is unaffected).
 */

/** Saves a Blob as a file named `filename`. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Saves text as a file. */
export function saveText(
  text: string,
  filename: string,
  type = 'text/plain;charset=utf-8',
): void {
  saveBlob(new Blob([text], {type}), filename);
}

/**
 * Opens a short-lived download URL by top-level navigation (`<a download>`).
 * The URL is neither cached nor stored.
 */
export function openDownloadLink(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** `YYYY-MM-DD` of a date in local time (file names). */
export function isoDay(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
