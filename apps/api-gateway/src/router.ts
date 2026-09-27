/**
 * @fileoverview Minimal method + path router over OpenAPI-style patterns
 * (`/objects/{rid}/links`). Literal segments win over parameters, so
 * `/objects/stats` is matched before `/objects/{rid}`.
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
  | {kind: 'not_found'};

/** Splits a path into non-empty segments. */
export function splitPath(path: string): string[] {
  return path.split('/').filter(s => s.length > 0);
}

/** Compiles a pattern; `{name}` segments are parameters. */
export function compilePattern(pattern: string): Segment[] {
  return splitPath(pattern).map(s => {
    const m = /^\{([A-Za-z][A-Za-z0-9_]*)\}$/.exec(s);
    return m ? {kind: 'param', name: m[1]} : {kind: 'literal', value: s};
  });
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
      continue;
    }
    try {
      params[seg.name] = decodeURIComponent(part);
    } catch {
      return null;
    }
  }
  return params;
}

/** Sort key: literal positions first, left to right. */
function rank(segments: Segment[]): string {
  return segments.map(s => (s.kind === 'literal' ? '0' : '1')).join('');
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
    this.entries.sort((a, b) =>
      rank(a.segments).localeCompare(rank(b.segments)),
    );
    return this;
  }

  /** Matches a request path (without the `/api/v1` prefix). */
  match(method: string, path: string): MatchResult<T> {
    const parts = splitPath(path);
    const m = method.toUpperCase();
    for (const e of this.entries) {
      if (e.method !== m && !(m === 'HEAD' && e.method === 'GET')) continue;
      const params = matchSegments(e.segments, parts);
      if (params) return {kind: 'found', value: e.value, params};
    }
    return {kind: 'not_found'};
  }
}
