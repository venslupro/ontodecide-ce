/**
 * @fileoverview Import API: jobs (list / one), create, mapping, synchronous
 * batches (idempotent by seq) and the AI mapping draft (≤ 2 per day). The
 * raw file never leaves the browser; only mapped-ready JSON rows are sent.
 */

import type {
  BatchInput,
  BatchResult,
  CreateImportInput,
  JobDto,
  MappingDraft,
  MappingDraftInput,
  MappingSpec,
} from '@ontodecide/integration/contract';
import type {PageResult} from '@ontodecide/shared-kernel';
import {useQuery} from '@tanstack/react-query';
import {api} from '../../shared/api/client';

/** Integration query keys (prefix `integration`). */
export const integrationKeys = {
  imports: () => ['integration', 'imports'] as const,
  job: (id: string) => ['integration', 'job', id] as const,
};

/** Import jobs of the workspace (newest first). */
export function useImports() {
  return useQuery({
    queryKey: integrationKeys.imports(),
    queryFn: () =>
      api.get<PageResult<JobDto>>('/imports', {query: {limit: 100}}),
    staleTime: 30_000,
  });
}

/** One job with its first ≤ 200 rejects. */
export function useImportJob(id: string | undefined) {
  return useQuery({
    queryKey: integrationKeys.job(id ?? ''),
    queryFn: () => api.get<JobDto>(`/imports/${encodeURIComponent(id!)}`),
    enabled: !!id,
    staleTime: 10_000,
  });
}

/** `POST /imports` (reserves `totalRows` of today's import rows). */
export function createImport(input: CreateImportInput): Promise<JobDto> {
  return api.post<JobDto>('/imports', input);
}

/** `PUT /imports/{id}/mapping` (before the first batch). */
export function putMapping(id: string, mapping: MappingSpec): Promise<JobDto> {
  return api.put<JobDto>(`/imports/${encodeURIComponent(id)}/mapping`, {
    mapping,
  });
}

/** `POST /imports/{id}/batches` (synchronous; same seq → first result). */
export function submitBatch(
  id: string,
  batch: BatchInput,
  signal?: AbortSignal,
): Promise<BatchResult> {
  return api.post<BatchResult>(
    `/imports/${encodeURIComponent(id)}/batches`,
    batch,
    {signal},
  );
}

/** `POST /imports/{id}/mapping-draft`. */
export function requestMappingDraft(
  id: string,
  input: MappingDraftInput,
): Promise<MappingDraft> {
  return api.post<MappingDraft>(
    `/imports/${encodeURIComponent(id)}/mapping-draft`,
    input,
  );
}

/** `GET /imports/{id}` (summary with the first ≤ 200 rejects). */
export function getImport(id: string): Promise<JobDto> {
  return api.get<JobDto>(`/imports/${encodeURIComponent(id)}`);
}
