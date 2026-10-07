/**
 * @fileoverview POST /workspace/sample-data: loads a built-in example
 * scenario, within the global daily seed budget, through the same mapping +
 * upsertBatch path as file imports (a `sample` job, one batch per object
 * type, ≤ 100 rows each). The caller picks a scenario id; the workspace
 * ontology is switched to that scenario's template first, so the sample
 * rows' object and link types exist. The system is not coupled to any
 * scenario — any of the built-in ones may be loaded, and users can still
 * import their own CSV / XLSX / JSON data. Loading is not restricted to
 * once per workspace: users may switch scenarios or reload (upserts are
 * keyed, so reloading the same scenario is idempotent); only the daily
 * seed-row budget limits usage.
 */

import {AppError, utcDay} from '@ontodecide/shared-kernel';
import type {CallCtx} from '@ontodecide/shared-kernel';
import type {CompiledSchema} from '@ontodecide/ontology/contract';
import type {JobDto, MappingSpec, SampleScenario} from '../contract';
import {getSampleScenario, toJobDto} from '../domain';
import type {JobRecord} from '../domain';
import {ingestBatch, MAX_BATCH_ROWS} from './batch_ingest';
import type {IntegrationDeps, StoredBatch, UsageRef} from './ports';

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

/** Loads the sample scenario `scenarioId`; see the file overview. */
export async function loadSample(
  deps: IntegrationDeps,
  ctx: CallCtx,
  scenarioId: string,
): Promise<JobDto> {
  const scenario: SampleScenario | null = getSampleScenario(scenarioId);
  if (!scenario) {
    throw new AppError('NOT_FOUND', `Unknown sample scenario: ${scenarioId}`);
  }
  const now = deps.clock.now();
  const budget: UsageRef = {day: utcDay(now), scope: '*', key: 'seed_rows'};
  if (
    !(await deps.usage.take(
      budget,
      scenario.seedRows,
      deps.config.seedRowsDaily,
    ))
  ) {
    throw new AppError('QUOTA_EXCEEDED', 'SEED_ROWS_DAILY');
  }

  // Switch the workspace ontology to the scenario's template so the sample
  // rows' types exist. The first call copies the template; subsequent calls
  // overwrite the copy.
  await deps.ontology.setTemplate(ctx, scenario.templateId);

  const nowMs = now.getTime();
  let job: JobRecord = {
    id: deps.newId(nowMs),
    kind: 'sample',
    fileName: null,
    targetType: scenario.templateId,
    mapping: null,
    status: 'RECEIVING',
    totalRows: scenario.objects,
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
    const chunks = scenario.datasets().flatMap(d => {
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
    await deps.usage.adjust(budget, -scenario.seedRows);
    deps.logger.warn('sample load failed', {
      tid: ctx.tid,
      scenarioId,
      code: AppError.from(e).code,
    });
    throw e;
  }
  // Reload the situation room so KPIs and sample automations match the newly
  // applied template and the just-loaded objects. This keeps the cockpit in
  // sync with whatever scenario (built-in or custom) the workspace switched to.
  await deps.situation.resetForTemplate(ctx);
  return toJobDto(job, deps.clock.now().getTime());
}
