/**
 * @fileoverview POST /workspace/sample-data: loads the built-in supply-chain
 * scenario (80 objects, 160 links) once per workspace, within the global
 * daily seed budget, through the same mapping + upsertBatch path as file
 * imports (a `sample` job, one batch per object type, ≤ 100 rows each).
 */

import {AppError, utcDay} from '@ontodecide/shared-kernel';
import type {CallCtx} from '@ontodecide/shared-kernel';
import {SUPPLY_CHAIN_TEMPLATE_ID} from '@ontodecide/ontology/contract';
import type {CompiledSchema} from '@ontodecide/ontology/contract';
import type {JobDto, MappingSpec} from '../contract';
import {
  SAMPLE_ROWS,
  SAMPLE_SEED_ROWS,
  sampleDatasets,
  toJobDto,
} from '../domain';
import type {JobRecord} from '../domain';
import {ingestBatch, MAX_BATCH_ROWS} from './batch_ingest';
import type {IntegrationDeps, StoredBatch, UsageRef} from './ports';

/** `day` of the once-per-workspace marker (not a calendar day). */
export const SEED_LOADED_DAY = 'once';

/** The workspace's sample marker. */
export function seedLoadedRef(ctx: CallCtx): UsageRef {
  return {day: SEED_LOADED_DAY, scope: ctx.tid, key: 'seed_loaded'};
}

/**
 * Keeps only mapped properties the workspace ontology defines, so a
 * customised ontology still loads what it can (required ones are checked).
 */
function fitMapping(spec: MappingSpec, schema: CompiledSchema): MappingSpec {
  const type = schema.objectTypes[spec.targetType];
  if (!type) return spec;
  return {
    ...spec,
    fields: spec.fields.filter(f => type.propsByName[f.to]),
    links: spec.links?.filter(l => schema.linkTypes[l.type]),
  };
}

/** Loads the sample scenario; see the file overview. */
export async function loadSample(
  deps: IntegrationDeps,
  ctx: CallCtx,
): Promise<JobDto> {
  const marker = seedLoadedRef(ctx);
  if ((await deps.usage.read(marker)) > 0) {
    throw new AppError('CONFLICT', 'SAMPLE_ALREADY_LOADED');
  }
  const now = deps.clock.now();
  const budget: UsageRef = {day: utcDay(now), scope: '*', key: 'seed_rows'};
  if (
    !(await deps.usage.take(
      budget,
      SAMPLE_SEED_ROWS,
      deps.config.seedRowsDaily,
    ))
  ) {
    throw new AppError('QUOTA_EXCEEDED', 'SEED_ROWS_DAILY');
  }
  if (!(await deps.usage.take(marker, 1, 1))) {
    await deps.usage.adjust(budget, -SAMPLE_SEED_ROWS);
    throw new AppError('CONFLICT', 'SAMPLE_ALREADY_LOADED');
  }

  const nowMs = now.getTime();
  let job: JobRecord = {
    id: deps.newId(nowMs),
    kind: 'sample',
    fileName: null,
    targetType: SUPPLY_CHAIN_TEMPLATE_ID,
    mapping: null,
    status: 'RECEIVING',
    totalRows: SAMPLE_ROWS,
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
    const schema = await deps.ontology.getCompiledSchema(ctx);
    const chunks = sampleDatasets().flatMap(d => {
      const out: {mapping: MappingSpec; rows: typeof d.rows}[] = [];
      for (let i = 0; i < d.rows.length; i += MAX_BATCH_ROWS) {
        out.push({
          mapping: fitMapping(d.mapping, schema),
          rows: d.rows.slice(i, i + MAX_BATCH_ROWS),
        });
      }
      return out;
    });
    const prior: StoredBatch[] = [];
    for (const [seq, chunk] of chunks.entries()) {
      const out = await ingestBatch(deps, ctx, {
        job,
        seq,
        last: seq === chunks.length - 1,
        rows: chunk.rows,
        mapping: chunk.mapping,
        schema,
        prior,
      });
      job = out.job;
      prior.push({
        seq,
        rows: chunk.rows.length,
        result: out.result,
        keys: [],
      });
    }
  } catch (e) {
    // Let the workspace retry: writes are idempotent upserts by key.
    await jobs.markFailed(job.id, deps.clock.now().getTime()).catch(() => {});
    await deps.usage.adjust(marker, -1);
    await deps.usage.adjust(budget, -SAMPLE_SEED_ROWS);
    deps.logger.warn('sample load failed', {
      tid: ctx.tid,
      code: AppError.from(e).code,
    });
    throw e;
  }
  return toJobDto(job, deps.clock.now().getTime());
}
