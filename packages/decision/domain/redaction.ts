/**
 * @fileoverview Redaction before LLM prompts: sensitive properties never
 * leave the platform (发往外部模型的数据先脱敏).
 */

import type {Rid} from '@ontodecide/shared-kernel';
import type {GraphNode} from '@ontodecide/object-graph/contract';
import type {CompiledModel} from '@ontodecide/ontology/contract';

/** Returns props without the sensitive properties of the object type. */
export function redactProps(
  model: Pick<CompiledModel, 'objectTypes'>,
  type: string,
  props: Record<string, unknown>,
): Record<string, unknown> {
  const ot = model.objectTypes[type];
  const sensitive = new Set(
    ot?.sensitiveProps ??
      ot?.properties?.filter(p => p.sensitive).map(p => p.apiName) ??
      [],
  );
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!sensitive.has(k)) out[k] = v;
  }
  return out;
}

/** A redacted object fact given to the LLM. */
export interface Fact {
  rid: Rid;
  type: string;
  title: string;
  delta: number;
  props: Record<string, unknown>;
}

/**
 * Builds redacted facts for the prompt: the focus first, then the most
 * affected nodes, capped at `max`.
 */
export function buildFacts(
  model: Pick<CompiledModel, 'objectTypes'>,
  nodes: readonly GraphNode[],
  delta: ReadonlyMap<Rid, number>,
  focus: Rid,
  max = 30,
): Fact[] {
  const ordered = [...nodes].sort((a, b) => {
    if (a.rid === focus) return -1;
    if (b.rid === focus) return 1;
    return (
      Math.abs(delta.get(b.rid) ?? 0) - Math.abs(delta.get(a.rid) ?? 0) ||
      a.rid.localeCompare(b.rid)
    );
  });
  return ordered.slice(0, max).map(n => ({
    rid: n.rid,
    type: n.type,
    title: n.title,
    delta: Math.round((delta.get(n.rid) ?? 0) * 10_000) / 10_000,
    props: redactProps(model, n.type, n.props),
  }));
}

/** Set of `rid|prop` pairs that evidence may reference. */
export function factKeys(facts: readonly Fact[]): Set<string> {
  const out = new Set<string>();
  for (const f of facts) {
    for (const k of Object.keys(f.props)) out.add(`${f.rid}|${k}`);
  }
  return out;
}
