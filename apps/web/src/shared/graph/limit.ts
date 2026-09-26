/**
 * @fileoverview Graph size limiting: keeps the N most important nodes and
 * aggregates the rest into "+N" nodes (one per hidden type).
 */

/** Generic graph node. */
export interface GNode {
  id: string;
  label: string;
  type: string;
  /** 0..1 impact intensity (impact mode). */
  impact?: number;
  /** Ranking score; higher is kept first. Defaults to impact. */
  score?: number;
  /** Hop distance from the root (lower is kept first on ties). */
  hop?: number;
  /** Aggregated hidden count for "+N" nodes. */
  hidden?: number;
  root?: boolean;
}

/** Generic graph edge. */
export interface GEdge {
  id?: string;
  source: string;
  target: string;
  type: string;
  label?: string;
  weight?: number | null;
}

/** Limits (前端详细设计 表 9). */
export const GRAPH_NODE_DEFAULT = 200;
export const GRAPH_NODE_MAX = 500;

/**
 * Keeps at most `max` nodes (roots always kept), ranking by score / impact
 * then hop. Hidden nodes are folded into one `+N` node per type attached to
 * the kept neighbors they connected to.
 */
export function limitGraph(
  nodes: readonly GNode[],
  edges: readonly GEdge[],
  max: number = GRAPH_NODE_MAX,
): {nodes: GNode[]; edges: GEdge[]; hiddenCount: number} {
  const cap = Math.max(1, Math.min(GRAPH_NODE_MAX, max));
  if (nodes.length <= cap)
    return {nodes: [...nodes], edges: [...edges], hiddenCount: 0};
  const ranked = [...nodes].sort((a, b) => {
    if (!!b.root !== !!a.root) return b.root ? 1 : -1;
    const sa = a.score ?? a.impact ?? 0;
    const sb = b.score ?? b.impact ?? 0;
    if (sb !== sa) return sb - sa;
    return (a.hop ?? 99) - (b.hop ?? 99);
  });
  const hiddenTypes = new Set(ranked.slice(cap).map(n => n.type));
  // Reserve room for aggregate nodes.
  const keepN = Math.max(1, cap - hiddenTypes.size);
  const kept = ranked.slice(0, keepN);
  const hidden = ranked.slice(keepN);
  const keptIds = new Set(kept.map(n => n.id));
  const hiddenType = new Map(hidden.map(n => [n.id, n.type] as const));
  const counts = new Map<string, number>();
  for (const h of hidden) counts.set(h.type, (counts.get(h.type) ?? 0) + 1);
  const aggNodes: GNode[] = [...counts].map(([type, n]) => ({
    id: `+${type}`,
    label: `+${n}`,
    type,
    hidden: n,
  }));
  const outEdges: GEdge[] = [];
  const aggEdgeSeen = new Set<string>();
  for (const e of edges) {
    const sKept = keptIds.has(e.source);
    const tKept = keptIds.has(e.target);
    if (sKept && tKept) {
      outEdges.push(e);
    } else if (sKept || tKept) {
      const hiddenId = sKept ? e.target : e.source;
      const type = hiddenType.get(hiddenId);
      if (!type) continue;
      const agg = `+${type}`;
      const src = sKept ? e.source : agg;
      const dst = sKept ? agg : e.target;
      const k = `${src}->${dst}`;
      if (aggEdgeSeen.has(k)) continue;
      aggEdgeSeen.add(k);
      outEdges.push({id: `agg:${k}`, source: src, target: dst, type: e.type});
    }
  }
  return {
    nodes: [...kept, ...aggNodes],
    edges: outEdges,
    hiddenCount: hidden.length,
  };
}

/** Fixed palette for object types (stable by type name). */
const TYPE_PALETTE = [
  '#22D3EE',
  '#3B82F6',
  '#8B5CF6',
  '#14B8A6',
  '#EC4899',
  '#A3E635',
  '#F472B6',
  '#60A5FA',
];

/** Stable color for an object type. */
export function typeColor(type: string, order?: readonly string[]): string {
  const idx = order?.indexOf(type) ?? -1;
  if (idx >= 0) return TYPE_PALETTE[idx % TYPE_PALETTE.length];
  let h = 0;
  for (let i = 0; i < type.length; i++) h = (h * 31 + type.charCodeAt(i)) >>> 0;
  return TYPE_PALETTE[h % TYPE_PALETTE.length];
}
