/**
 * @fileoverview Minimal segment router. A segment is a parameter only when
 * it starts with `:`; literal segments may contain colons (Google-style
 * custom methods such as `/recommendations:generate` or
 * `/users/:id/password:reset`).
 */

/** Compiled path segment. */
type Segment = {kind: 'literal'; value: string} | {kind: 'param'; name: string};

interface Entry<T> {
  method: string;
  segments: Segment[];
  value: T;
}

/** Result of {@link Router.match}. */
export type MatchResult<T> =
  | {kind: 'found'; value: T; params: Record<string, string>}
  | {kind: 'method_not_allowed'; allow: string[]}
  | {kind: 'not_found'};

/** Splits a path into non-empty segments. */
export function splitPath(path: string): string[] {
  return path.split('/').filter(s => s.length > 0);
}

/** Compiles a route pattern. */
export function compilePattern(pattern: string): Segment[] {
  return splitPath(pattern).map(s =>
    s.startsWith(':')
      ? {kind: 'param', name: s.slice(1)}
      : {kind: 'literal', value: s},
  );
}

function matchSegments(
  segments: Segment[],
  parts: string[],
): Record<string, string> | null {
  if (segments.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const part = parts[i];
    if (seg.kind === 'literal') {
      if (seg.value !== part) return null;
    } else {
      let decoded: string;
      try {
        decoded = decodeURIComponent(part);
      } catch {
        return null;
      }
      params[seg.name] = decoded;
    }
  }
  return params;
}

/** Counts literal segments, so more specific patterns win ties. */
function specificity(segments: Segment[]): number {
  return segments.filter(s => s.kind === 'literal').length;
}

/** Method + path router. */
export class Router<T> {
  private readonly entries: Entry<T>[] = [];

  /** Registers a route. */
  add(method: string, pattern: string, value: T): this {
    this.entries.push({
      method: method.toUpperCase(),
      segments: compilePattern(pattern),
      value,
    });
    // Most specific first, stable for equal specificity.
    this.entries.sort(
      (a, b) => specificity(b.segments) - specificity(a.segments),
    );
    return this;
  }

  /** Matches a request path (without the `/api/v1` prefix). */
  match(method: string, path: string): MatchResult<T> {
    const parts = splitPath(path);
    const m = method.toUpperCase();
    const allow = new Set<string>();
    for (const e of this.entries) {
      const params = matchSegments(e.segments, parts);
      if (!params) continue;
      if (e.method === m || (m === 'HEAD' && e.method === 'GET')) {
        return {kind: 'found', value: e.value, params};
      }
      allow.add(e.method);
    }
    if (allow.size > 0) return {kind: 'method_not_allowed', allow: [...allow]};
    return {kind: 'not_found'};
  }
}
