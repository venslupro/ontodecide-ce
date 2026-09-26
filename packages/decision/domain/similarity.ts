/**
 * @fileoverview Vector and keyword similarity used by case recall when no
 * vector index is available.
 */

/** Cosine similarity of two vectors (0 when either is zero). */
export function cosine(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** Lower-cased word and CJK-character tokens. */
export function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const out: string[] = [];
  for (const w of words) {
    if (/\p{Script=Han}/u.test(w)) out.push(...w);
    else if (w.length > 1) out.push(w);
  }
  return out;
}

/** Jaccard similarity of token sets. */
export function keywordSimilarity(a: string, b: string): number {
  const x = new Set(tokenize(a));
  const y = new Set(tokenize(b));
  if (x.size === 0 || y.size === 0) return 0;
  let inter = 0;
  for (const t of x) if (y.has(t)) inter++;
  return inter / (x.size + y.size - inter);
}
