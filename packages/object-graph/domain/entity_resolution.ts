/**
 * @fileoverview Fuzzy entity resolution on object titles: NFKC
 * normalization and Jaro-Winkler similarity. Exact `(type, primaryKey)` and
 * alias matching happen in the application layer (they need I/O).
 */

import type {Rid} from '@ontodecide/shared-kernel';
import {GRAPH_LIMITS} from '../contract/types';

/** NFKC-normalizes, strips punctuation/symbols, collapses spaces, lowercases. */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKC')
    .replace(/[\p{P}\p{S}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** First character of the normalized title (candidate bucket), or ''. */
export function fuzzyBucket(title: string): string {
  const n = normalizeTitle(title);
  return n ? [...n][0] : '';
}

/** Jaro similarity in [0, 1]. */
export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  const s1 = [...a];
  const s2 = [...b];
  if (s1.length === 0 || s2.length === 0) return 0;
  const window = Math.max(
    0,
    Math.floor(Math.max(s1.length, s2.length) / 2) - 1,
  );
  const m1 = new Array<boolean>(s1.length).fill(false);
  const m2 = new Array<boolean>(s2.length).fill(false);
  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(s2.length - 1, i + window);
    for (let j = lo; j <= hi; j++) {
      if (m2[j] || s1[i] !== s2[j]) continue;
      m1[i] = true;
      m2[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!m1[i]) continue;
    while (!m2[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  const t = transpositions / 2;
  return (
    (matches / s1.length + matches / s2.length + (matches - t) / matches) / 3
  );
}

/** Jaro-Winkler similarity in [0, 1] (prefix scale 0.1, prefix ≤ 4). */
export function jaroWinkler(a: string, b: string, prefixScale = 0.1): number {
  const j = jaro(a, b);
  const s1 = [...a];
  const s2 = [...b];
  let prefix = 0;
  const max = Math.min(4, s1.length, s2.length);
  while (prefix < max && s1[prefix] === s2[prefix]) prefix++;
  return j + prefix * prefixScale * (1 - j);
}

/** A candidate for fuzzy matching. */
export interface FuzzyCandidate {
  rid: Rid;
  title: string;
}

/** A fuzzy match above the threshold. */
export interface FuzzyMatch {
  rid: Rid;
  score: number;
}

/**
 * Finds the best candidate whose normalized title shares the first
 * character and reaches the threshold. Returns null when there are more
 * than 200 candidates (fuzzy matching is skipped) or nothing matches.
 */
export function bestFuzzyMatch(
  title: string,
  candidates: readonly FuzzyCandidate[],
  opts: {threshold?: number; maxCandidates?: number; exclude?: string} = {},
): FuzzyMatch | null {
  const threshold = opts.threshold ?? GRAPH_LIMITS.fuzzyThreshold;
  const maxCandidates = opts.maxCandidates ?? GRAPH_LIMITS.fuzzyCandidatesMax;
  if (candidates.length > maxCandidates) return null;
  const n = normalizeTitle(title);
  if (!n) return null;
  const bucket = [...n][0];
  let best: FuzzyMatch | null = null;
  for (const c of candidates) {
    if (c.rid === opts.exclude) continue;
    const cn = normalizeTitle(c.title);
    if (!cn || [...cn][0] !== bucket) continue;
    const score = jaroWinkler(n, cn);
    if (score >= threshold && (!best || score > best.score)) {
      best = {rid: c.rid, score: Math.round(score * 10_000) / 10_000};
    }
  }
  return best;
}
