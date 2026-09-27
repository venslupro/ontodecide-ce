/**
 * @fileoverview Ontology definition mutations for the workbench. The
 * workspace has a single ontology version: `POST /{kind}` creates,
 * `PUT /{kind}/{id}` replaces and `DELETE /{kind}/{id}` removes a
 * definition, each with If-Match = the schema ETag. The first change copies
 * the shared template (copy-on-write). Reads use `useOntology()`.
 */

import type {DefByKind, DefKind} from '@ontodecide/ontology/contract';
import {useMutation, useQueryClient} from '@tanstack/react-query';
import {apiRequest} from '../../shared/api/client';
import {ontologyKey} from '../../entities/schema/api';

/** Save input. */
export type SaveDefinitionInput<K extends DefKind = DefKind> = {
  kind: K;
  def: DefByKind[K];
  /** Schema ETag the edit is based on. */
  etag: number;
  /** Existing id (PUT); absent for a new definition (POST). */
  id?: string;
};

/** Creates or replaces a definition; resolves to the new schema etag. */
export async function saveDefinition(v: SaveDefinitionInput): Promise<number> {
  const path = v.id ? `/${v.kind}/${encodeURIComponent(v.id)}` : `/${v.kind}`;
  const res = await apiRequest<{etag?: number}>(path, {
    method: v.id ? 'PUT' : 'POST',
    body: v.def,
    ifMatch: v.etag,
  });
  return res.version ?? res.data?.etag ?? v.etag + 1;
}

/** Deletes a definition; resolves to the new schema etag. */
export async function deleteDefinition(v: {
  kind: DefKind;
  id: string;
  etag: number;
}): Promise<number> {
  const res = await apiRequest<{etag?: number}>(
    `/${v.kind}/${encodeURIComponent(v.id)}`,
    {method: 'DELETE', ifMatch: v.etag},
  );
  return res.version ?? res.data?.etag ?? v.etag + 1;
}

/** Save mutation (refreshes the ontology and every ontology-driven view). */
export function useSaveDefinition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: saveDefinition,
    onSettled: () => void qc.invalidateQueries({queryKey: ontologyKey()}),
  });
}

/** Delete mutation. */
export function useDeleteDefinition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteDefinition,
    onSettled: () => void qc.invalidateQueries({queryKey: ontologyKey()}),
  });
}
