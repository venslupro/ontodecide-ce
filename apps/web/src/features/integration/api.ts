/**
 * @fileoverview Data integration queries & mutations: sources, uploads,
 * batches, jobs, rejected records, data health and AI mapping drafts.
 */

import type {
  DataHealthDto,
  JobDto,
  RawRecordDto,
  SourceDef,
  SourceDto,
  TxnType,
} from '@ontodecide/integration/contract';
import type {MappingSuggestion} from '@ontodecide/decision/contract';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {api, asList} from '../../shared/api/client';
import {qk} from '../../shared/api/query_keys';

/** Terminal job states. */
export const JOB_DONE: ReadonlySet<JobDto['status']> = new Set([
  'Succeeded',
  'PartiallyFailed',
  'Failed',
]);

/** All sources. */
export function useSources() {
  return useQuery({
    queryKey: qk.sources(),
    queryFn: async () => asList(await api.get<SourceDto[]>('/sources')),
  });
}

/** One source. */
export function useSource(id: string | undefined) {
  return useQuery({
    queryKey: qk.source(id ?? ''),
    queryFn: () => api.get<SourceDto>(`/sources/${encodeURIComponent(id!)}`),
    enabled: !!id,
  });
}

/** Creates a source. */
export function useCreateSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (def: SourceDef) => api.post<SourceDto>('/sources', def),
    onSuccess: () => qc.invalidateQueries({queryKey: qk.sources()}),
  });
}

/** Updates a source. */
export function useUpdateSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({id, patch}: {id: string; patch: Partial<SourceDef>}) =>
      api.patch<SourceDto>(`/sources/${encodeURIComponent(id)}`, patch),
    onSuccess: s => {
      qc.setQueryData(qk.source(s.id), s);
      void qc.invalidateQueries({queryKey: qk.sources()});
    },
  });
}

/** Deletes a source. */
export function useDeleteSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/sources/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({queryKey: qk.sources()}),
  });
}

/** Presigned B2 upload for archiving the raw file (url may be empty when B2 is not configured). */
export function presignUpload(
  sourceId: string,
  fileName: string,
  bytes: number,
) {
  return api.post<{url: string; key: string; expiresAt: string; jobId: string}>(
    `/sources/${encodeURIComponent(sourceId)}/uploads:presign`,
    {fileName, bytes},
  );
}

/** Batch body. */
export interface BatchInput {
  jobId?: string;
  seq: number;
  last: boolean;
  records: Record<string, unknown>[];
  txnType?: TxnType;
}

/** Submits one ≤ 500-record batch (202). */
export function submitBatch(
  sourceId: string,
  batch: BatchInput,
  idempotencyKey: string,
  signal?: AbortSignal,
) {
  return api.post<{jobId: string; queuedMessages: number}>(
    `/sources/${encodeURIComponent(sourceId)}/batches`,
    batch,
    {
      idempotencyKey,
      signal,
    },
  );
}

/** Asks for an AI mapping draft (counts against the daily AI quota). */
export function suggestMapping(
  sourceId: string,
  sample: {fields: string[]; rows: unknown[][]; targetType: string},
) {
  return api.post<MappingSuggestion>(
    `/sources/${encodeURIComponent(sourceId)}/mapping:suggest`,
    sample,
  );
}

/** Jobs (optionally for one source). */
export function useJobs(sourceId?: string) {
  return useQuery({
    queryKey: qk.jobs(sourceId),
    queryFn: async () =>
      asList(await api.get<JobDto[]>('/jobs', {query: {sourceId}})),
  });
}

/** One job; polls every 2 s until it reaches a terminal state. */
export function useJob(id: string | undefined) {
  return useQuery({
    queryKey: qk.job(id ?? ''),
    queryFn: () => api.get<JobDto>(`/jobs/${encodeURIComponent(id!)}`),
    enabled: !!id,
    refetchInterval: q =>
      q.state.data && JOB_DONE.has(q.state.data.status) ? false : 2000,
  });
}

/** Rejected records of a job. */
export function useRejected(jobId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.rejected(jobId ?? ''),
    queryFn: async () =>
      asList(
        await api.get<RawRecordDto[]>(
          `/jobs/${encodeURIComponent(jobId!)}/rejected`,
        ),
      ),
    enabled: !!jobId && enabled,
  });
}

/** Replays rejected records with optional corrected payloads. */
export function useReplay(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fixes?: {id: string; payload: Record<string, unknown>}[]) =>
      api.post<{requeued: number}>(
        `/jobs/${encodeURIComponent(jobId)}/replay`,
        {fixes},
      ),
    onSuccess: () => {
      void qc.invalidateQueries({queryKey: qk.job(jobId)});
      void qc.invalidateQueries({queryKey: qk.rejected(jobId)});
    },
  });
}

/** Per-source data health. */
export function useDataHealth() {
  return useQuery({
    queryKey: qk.dataHealth(),
    queryFn: async () => asList(await api.get<DataHealthDto[]>('/data-health')),
  });
}
