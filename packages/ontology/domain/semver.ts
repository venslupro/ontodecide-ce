/**
 * @fileoverview Minimal semantic-version helpers (`MAJOR.MINOR.PATCH`).
 */

/** A parsed semantic version. */
export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/** Whether the value is a `MAJOR.MINOR.PATCH` version string. */
export function isSemver(value: unknown): value is string {
  return typeof value === 'string' && SEMVER_RE.test(value);
}

/** Parses a version; throws on invalid input. */
export function parseSemver(value: string): Semver {
  const m = SEMVER_RE.exec(value);
  if (!m) throw new Error(`Invalid semantic version: ${value}`);
  return {major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3])};
}

/** Compares two versions: negative if a < b, 0 if equal, positive if a > b. */
export function compareSemver(a: string, b: string): number {
  const x = parseSemver(a);
  const y = parseSemver(b);
  return x.major - y.major || x.minor - y.minor || x.patch - y.patch;
}

/** Returns the highest version of the list, or null when empty. */
export function maxSemver(versions: readonly string[]): string | null {
  let best: string | null = null;
  for (const v of versions) {
    if (!isSemver(v)) continue;
    if (best === null || compareSemver(v, best) > 0) best = v;
  }
  return best;
}

/** Bumps one component of a version. */
export function bumpSemver(
  value: string,
  part: 'major' | 'minor' | 'patch',
): string {
  const v = parseSemver(value);
  if (part === 'major') return `${v.major + 1}.0.0`;
  if (part === 'minor') return `${v.major}.${v.minor + 1}.0`;
  return `${v.major}.${v.minor}.${v.patch + 1}`;
}
