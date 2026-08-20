/**
 * Transformer: map extracted records onto the tenant's ontology type.
 *
 * Each record is converted into an `EntityNode` (or skipped if required
 * fields are missing). The mapping rules are:
 *   1. If `fieldMapping` is provided, rename record keys accordingly.
 *   2. If the record has an `id`, use it; otherwise generate a UUID.
 *   3. Coerce numeric fields where possible (latency, severity, etc.).
 *   4. Reject records that lack all attributes (degenerate input).
 */
import {uuid, type EntityNode, type EntityRelation} from '@ontodecide/shared';
import type {ExtractedRecord} from './extractor.js';

export interface TransformResult {
  entities: EntityNode[];
  relations: EntityRelation[];
  rejected: number;
}

/** Default mapping: every CSV/JSON field maps to the same attribute name. */
const DEFAULT_MAPPING: Record<string, string> = {};

/** Transform raw records into entity / relation payloads. */
export function transform(
    records: ExtractedRecord[],
    tenantId: string,
    ontologyType: string,
    source: string,
    fieldMapping: Record<string, string> = DEFAULT_MAPPING,
): TransformResult {
  const entities: EntityNode[] = [];
  const relations: EntityRelation[] = [];
  let rejected = 0;
  for (const raw of records) {
    const mapped = applyMapping(raw, fieldMapping);
    if (Object.keys(mapped).length === 0) {
      rejected++;
      continue;
    }
    const id = String(mapped.id ?? uuid());
    const {id: _omit, ...attributes} = mapped;
    void _omit;
    entities.push({
      id,
      tenant_id: tenantId,
      type: ontologyType,
      attributes: coerceNumbers(attributes),
      source,
      confidence: Number(mapped.confidence ?? 0.5),
      timestamp: String(mapped.timestamp ?? new Date().toISOString()),
    });
    // Optional relations: records may carry a `_relations` array describing
    // outgoing edges to other entities (by id).
    const relArray = mapped._relations;
    if (Array.isArray(relArray)) {
      for (const rel of relArray) {
        if (!rel || typeof rel !== 'object') continue;
        const r = rel as {type?: string; target?: string; properties?: Record<string, unknown>};
        if (!r.type || !r.target) continue;
        relations.push({
          type: String(r.type).toUpperCase(),
          source: id,
          target: String(r.target),
          properties: r.properties,
        });
      }
    }
  }
  return {entities, relations, rejected};
}

function applyMapping(
    record: ExtractedRecord,
    mapping: Record<string, string>,
): Record<string, unknown> {
  if (Object.keys(mapping).length === 0) return {...record};
  const out: Record<string, unknown> = {};
  for (const [sourceKey, targetKey] of Object.entries(mapping)) {
    if (sourceKey in record) {
      out[targetKey] = record[sourceKey];
    }
  }
  // Pass through keys not mentioned in the mapping so nothing is silently lost.
  for (const [key, value] of Object.entries(record)) {
    if (!(key in out)) out[key] = value;
  }
  return out;
}

/** Coerce string values that look like numbers into actual numbers. */
function coerceNumbers(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed !== '' && Number.isFinite(Number(trimmed))) {
        out[key] = Number(trimmed);
        continue;
      }
      if (trimmed === 'true') {
        out[key] = true;
        continue;
      }
      if (trimmed === 'false') {
        out[key] = false;
        continue;
      }
    }
    out[key] = value;
  }
  return out;
}
