/**
 * @fileoverview Import job use cases: create (headroom check + atomic
 * reservation of the day's import rows), set mapping, read and list.
 */

import {
  AppError,
  clampLimit,
  decodeCursor,
  encodeCursor,
  utcDay,
} from '@ontodecide/shared-kernel';
import type {CallCtx, PageRequest, PageResult} from '@ontodecide/shared-kernel';
import type {CreateImportInput, JobDto, MappingSpec} from '../contract';
import {assertMapping, toJobDto} from '../domain';
import type {JobRecord} from '../domain';
import type {IntegrationDeps, UsageRef} from './ports';

/** The caller's import-rows counter for today. */
export function importRowsRef(ctx: CallCtx, now: Date): UsageRef {
  return {day: utcDay(now), scope: ctx.tid, key: 'import_rows'};
}

/**
 * POST /imports. Checks object / link headroom through ObjectGraphRpc.stats,
 * validates an optional mapping against the current ontology, then reserves
 * `totalRows` of the caller's daily import rows (conditional update, never
 * overshoots under concurrency). QUOTA_EXCEEDED when either check fails.
 */
export async function createImport(
  deps: IntegrationDeps,
  ctx: CallCtx,
  input: CreateImportInput,
): Promise<JobDto> {
  const {config} = deps;
  if (input.mapping && input.mapping.targetType !== input.targetType) {
    throw new AppError('VALIDATION_FAILED', 'mapping.targetType mismatch');
  }
  const schema = await deps.ontology.getCompiledSchema(ctx);
  if (!schema.objectTypes[input.targetType]) {
    throw new AppError('VALIDATION_FAILED', `Unknown type ${input.targetType}`);
  }
  if (input.mapping) assertMapping(input.mapping, schema);

  const stats = await deps.objects.stats(ctx);
  const needsLinks = (input.mapping?.links?.length ?? 0) > 0;
  if (
    stats.objects >= config.maxObjects ||
    (needsLinks && stats.links >= config.maxLinks)
  ) {
    throw new AppError('QUOTA_EXCEEDED', 'OBJECT_LIMIT', {
      extras: {
        objects: {used: stats.objects, limit: config.maxObjects},
        links: {used: stats.links, limit: config.maxLinks},
      },
    });
  }

  const now = deps.clock.now();
  const ref = importRowsRef(ctx, now);
  const granted = await deps.usage.take(
    ref,
    input.totalRows,
    config.importRowsDaily,
  );
  if (!granted) {
    const used = await deps.usage.read(ref);
    throw new AppError('QUOTA_EXCEEDED', 'IMPORT_ROWS_DAILY', {
      extras: {used, limit: config.importRowsDaily},
    });
  }

  const nowMs = now.getTime();
  const job: JobRecord = {
    id: deps.newId(nowMs),
    kind: 'file',
    fileName: input.fileName,
    targetType: input.targetType,
    mapping: input.mapping ?? null,
    status: 'RECEIVING',
    totalRows: input.totalRows,
    received: 0,
    upserted: 0,
    skipped: 0,
    rejected: 0,
    createdAt: nowMs,
    updatedAt: nowMs,
  };
  const jobs = deps.jobs(ctx);
  try {
    await jobs.insert(job);
    if (input.mapping) {
      await jobs.saveMapping(input.fileName, input.mapping, nowMs);
    }
  } catch (e) {
    await deps.usage.adjust(ref, -input.totalRows);
    throw e;
  }
  return toJobDto(job, nowMs);
}

/** Loads a job or throws NOT_FOUND. */
export async function requireJob(
  deps: IntegrationDeps,
  ctx: CallCtx,
  jobId: string,
): Promise<JobRecord> {
  const job = await deps.jobs(ctx).get(jobId);
  if (!job) throw new AppError('NOT_FOUND', 'IMPORT_NOT_FOUND');
  return job;
}

/**
 * PUT /imports/{id}/mapping. Allowed only while no batch was received
 * (CONFLICT otherwise); validated against the current ontology.
 */
export async function putMapping(
  deps: IntegrationDeps,
  ctx: CallCtx,
  jobId: string,
  mapping: MappingSpec,
): Promise<JobDto> {
  const job = await requireJob(deps, ctx, jobId);
  if (job.kind !== 'file') throw new AppError('CONFLICT', 'SAMPLE_JOB');
  if (mapping.targetType !== job.targetType) {
    throw new AppError('VALIDATION_FAILED', 'mapping.targetType mismatch');
  }
  if (job.received > 0) throw new AppError('CONFLICT', 'IMPORT_STARTED');
  const schema = await deps.ontology.getCompiledSchema(ctx);
  assertMapping(mapping, schema);
  const nowMs = deps.clock.now().getTime();
  const jobs = deps.jobs(ctx);
  if (!(await jobs.setMapping(jobId, mapping, nowMs))) {
    throw new AppError('CONFLICT', 'IMPORT_STARTED');
  }
  await jobs.saveMapping(job.fileName, mapping, nowMs);
  return toJobDto({...job, mapping, updatedAt: nowMs}, nowMs);
}

/** GET /imports/{id}, with the first ≤ 200 rejects. */
export async function getImport(
  deps: IntegrationDeps,
  ctx: CallCtx,
  jobId: string,
): Promise<JobDto> {
  const job = await requireJob(deps, ctx, jobId);
  const rejects = await deps.jobs(ctx).rejects(jobId);
  return toJobDto(job, deps.clock.now().getTime(), rejects);
}

/** GET /imports, newest first, cursor paged. */
export async function listImports(
  deps: IntegrationDeps,
  ctx: CallCtx,
  page: PageRequest,
): Promise<PageResult<JobDto>> {
  const limit = clampLimit(page.limit);
  const cursor = decodeCursor<{id?: unknown}>(page.cursor);
  const before = typeof cursor?.id === 'string' ? cursor.id : null;
  const rows = await deps.jobs(ctx).list(before, limit + 1);
  const nowMs = deps.clock.now().getTime();
  const items = rows.slice(0, limit).map(j => toJobDto(j, nowMs));
  return {
    items,
    nextCursor:
      rows.length > limit
        ? encodeCursor({id: items[items.length - 1].id})
        : null,
  };
}
