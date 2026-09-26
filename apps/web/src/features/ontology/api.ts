/**
 * @fileoverview Ontology workbench queries & mutations.
 */

import type {
  DiffReport,
  DraftDto,
  OntologyPack,
  PackSummary,
  PublishReport,
  SchemaDef,
  SchemaSummary,
} from '@ontodecide/ontology/contract';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {api, asList} from '../../shared/api/client';
import {qk} from '../../shared/api/query_keys';

export {useSchema} from '../../entities/schema/api';

/** Schema listing. */
export function useSchemas() {
  return useQuery({
    queryKey: qk.schemas(),
    queryFn: async () =>
      asList(await api.get<SchemaSummary[]>('/ontology/schemas')),
  });
}

/** Saves a draft (Modeler). */
export function useSaveDraft(apiName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (def: SchemaDef) =>
      api.put<DraftDto>(
        `/ontology/schemas/${encodeURIComponent(apiName)}/draft`,
        def,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({queryKey: qk.schema(apiName, 'draft')});
      void qc.invalidateQueries({queryKey: qk.schemas()});
      void qc.invalidateQueries({queryKey: qk.diff(apiName)});
    },
  });
}

/** Computes the draft vs current diff. */
export function useDiff(apiName: string) {
  return useMutation({
    mutationFn: () =>
      api.post<DiffReport>(
        `/ontology/schemas/${encodeURIComponent(apiName)}/diff`,
      ),
  });
}

/** Publishes the draft; breaking changes need `confirmVersion`. */
export function usePublish(apiName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: {confirmVersion?: string}) =>
      api.post<PublishReport>(
        `/ontology/schemas/${encodeURIComponent(apiName)}/publish`,
        opts,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({queryKey: ['ontology']});
    },
  });
}

/** Available packs. */
export function usePacks() {
  return useQuery({
    queryKey: qk.packs(),
    queryFn: async () =>
      asList(await api.get<PackSummary[]>('/ontology/packs')),
  });
}

/** Imports a pack by id or inline. */
export function useImportPack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {packId?: string; pack?: OntologyPack}) =>
      api.post<{report: PublishReport; pack?: OntologyPack}>(
        '/ontology/packs:import',
        input,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({queryKey: ['ontology']});
      void qc.invalidateQueries({queryKey: ['situation']});
    },
  });
}

/** Exports a schema as a pack. */
export function exportPack(apiName: string): Promise<OntologyPack> {
  return api.get<OntologyPack>(
    `/ontology/schemas/${encodeURIComponent(apiName)}/export`,
  );
}
