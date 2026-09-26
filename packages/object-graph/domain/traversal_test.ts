import {describe, expect, it} from 'vitest';
import type {Rid} from '@ontodecide/shared-kernel';
import type {StoredLink} from './stored_object';
import {bfs, findPaths} from './traversal';

const r = (s: string) => s as Rid;
const e = (src: string, dst: string, type = 'l'): StoredLink => ({
  type,
  src: r(src),
  dst: r(dst),
});
const edges = [
  e('S', 'M1'),
  e('S', 'M2'),
  e('M1', 'P1'),
  e('M2', 'P1'),
  e('M2', 'P2'),
  e('P1', 'X'),
];

describe('traversal', () => {
  it('BFS assigns minimal hops and respects maxHops', () => {
    const t = bfs([r('S')], edges, 2, 100);
    expect(Object.fromEntries(t.hops)).toEqual({
      S: 0,
      M1: 1,
      M2: 1,
      P1: 2,
      P2: 2,
    });
    expect(t.edges).toHaveLength(5);
    expect(t.truncated).toBe(false);
    expect(bfs([r('S')], edges, 3, 100).hops.get(r('X'))).toBe(3);
  });

  it('BFS stops at the node limit', () => {
    const t = bfs([r('S')], edges, 3, 3);
    expect(t.hops.size).toBe(3);
    expect(t.truncated).toBe(true);
  });

  it('finds paths in both directions, shortest first', () => {
    const p = findPaths(edges, r('M1'), r('P2'), 4);
    expect(p).toHaveLength(2);
    expect(p).toContainEqual(['M1', 'P1', 'M2', 'P2']);
    expect(p).toContainEqual(['M1', 'S', 'M2', 'P2']);
    expect(findPaths(edges, r('S'), r('X'), 2)).toEqual([]);
    expect(findPaths(edges, r('S'), r('X'), 3)[0]).toHaveLength(4);
    expect(findPaths(edges, r('S'), r('S'), 3)).toEqual([['S']]);
  });
});
