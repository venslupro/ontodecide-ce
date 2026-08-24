/**
 * Ontology-type resource (Graph service).
 *
 * Covers {@code GET /api/ontology} (list all tenant-defined types) and
 * {@code POST /api/ontology} (create or upsert a single type).
 */
import { httpGet, httpPost } from './client';
import type { ApiResponse, OntologyType } from '@ontodecide/shared';

/** {@code GET /api/ontology}. */
export async function list(): Promise<ApiResponse<OntologyType[]>> {
  return httpGet<OntologyType[]>('/api/ontology');
}

/** {@code POST /api/ontology} — create or update a type definition. */
export async function upsert(
  body: OntologyType,
): Promise<ApiResponse<OntologyType>> {
  return httpPost<OntologyType>('/api/ontology', body);
}
