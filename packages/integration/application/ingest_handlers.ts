/**
 * @fileoverview Pipeline use cases: the ingest-queue consumer (map, quality,
 * emit object-writes) and object-graph's write-result report.
 */

import {AppError} from '@ontodecide/shared-kernel';
import type {CallCtx} from '@ontodecide/shared-kernel';
import type {IngestMsg, UpsertCmd, WriteResult} from '../contract';
import {INGEST_LIMITS} from '../contract';
import {groupSeq, mapRecord, REJECT_CODES, splitRecords} from '../domain';
import {checkJobCompletion} from './job_progress';
import type {AppDeps, RejectedRow} from './ports';

/**
 * Processes one ingest message. Non-retryable problems (unknown source or
 * target type) turn every record into a rejected row; anything thrown is
 * transient and the caller retries the message.
 */
export class ProcessIngestMessage {
  constructor(private readonly deps: AppDeps) {}

  async execute(msg: IngestMsg): Promise<void> {
    const {ctx, jobId, seq} = msg;
    const {jobs, sources} = this.deps;
    if (await jobs.isIngestProcessed(ctx, jobId, seq)) return;
    const job = await jobs.get(ctx, jobId);
    if (!job || job.finishedAt !== null) {
      this.deps.logger.warn('ingest message for unknown or finished job', {
        tenantId: ctx.tenantId,
        jobId,
        seq,
      });
      return;
    }
    const rows = msg.records.map((record, i) => ({
      record,
      row: msg.rowOffset + i,
    }));
    const rejectAll = (code: string, detail: string) =>
      this.finish(
        ctx,
        msg,
        0,
        rows.map(r => ({row: r.row, payload: r.record, code, detail})),
        0,
      );

    const source = await sources.get(ctx, msg.sourceId);
    if (!source)
      return rejectAll(REJECT_CODES.sourceUnavailable, 'Source was deleted');
    if (source.paused) {
      return rejectAll(
        REJECT_CODES.sourceUnavailable,
        'Source is paused (ontology breaking change)',
      );
    }
    const model = await this.deps.models.get(ctx);
    const targetType = model.objectTypes[source.mapping.targetType];
    if (!targetType) {
      return rejectAll(
        REJECT_CODES.schemaMismatch,
        `Unknown target type ${source.mapping.targetType}`,
      );
    }
    const now = this.deps.clock.now();
    const mappingCtx = {
      mapping: source.mapping,
      qualityRules: source.qualityRules,
      targetType,
      now,
      provenance: {
        sourceId: source.id,
        datasetTxn: jobId,
        ingestedAt: now.toISOString(),
        confidence: 1,
        priority: source.priority,
      },
    };
    const cmds: UpsertCmd[] = [];
    const rejected: RejectedRow[] = [];
    let warnings = 0;
    for (const {record, row} of rows) {
      const r = mapRecord(record, row, mappingCtx);
      if (r.ok) {
        cmds.push(r.cmd);
        if (r.warnings.length > 0) warnings++;
      } else {
        rejected.push({
          row,
          payload: record,
          code: r.rejection.code,
          detail: r.rejection.detail,
        });
      }
    }
    await jobs.markRunning(ctx, jobId);
    // Normally one group; more only if the mapped commands outgrow a message.
    const groups = splitRecords(cmds, {
      maxRecords: INGEST_LIMITS.messageRecordsMax,
    });
    for (let k = 0; k < groups.length; k++) {
      await this.deps.objectWrites.publish({
        ctx,
        jobId,
        seq: groupSeq(seq, k),
        last: msg.last && k === groups.length - 1,
        schemaVersion: model.version,
        policy: source.conflictPolicy,
        cmds: groups[k].records,
      });
    }
    await this.finish(ctx, msg, groups.length, rejected, warnings);
  }

  private async finish(
    ctx: CallCtx,
    msg: IngestMsg,
    groups: number,
    rejected: RejectedRow[],
    warnings: number,
  ): Promise<void> {
    const now = this.deps.clock.now().getTime();
    const first = await this.deps.jobs.recordIngest(
      ctx,
      msg.jobId,
      {seq: msg.seq, groups, rejected, warnings},
      now,
    );
    if (first) await checkJobCompletion(this.deps, ctx, msg.jobId);
  }
}

/** Records object-graph's result for one object-writes group. */
export class ReportWriteResult {
  constructor(private readonly deps: AppDeps) {}

  async execute(
    ctx: CallCtx,
    jobId: string,
    seq: number,
    _last: boolean,
    r: WriteResult,
  ): Promise<void> {
    const job = await this.deps.jobs.get(ctx, jobId);
    if (!job) throw new AppError('NOT_FOUND', 'Job not found');
    const n = (v: unknown) =>
      typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
    const rejected: RejectedRow[] = (
      Array.isArray(r?.rejected) ? r.rejected : []
    ).map(x => ({
      row: n(x.row),
      payload: {},
      code: String(x.code ?? 'WRITE_REJECTED'),
      ...(x.detail ? {detail: String(x.detail)} : {}),
    }));
    const first = await this.deps.jobs.recordGroup(
      ctx,
      jobId,
      seq,
      {
        upserted: n(r?.upserted),
        merged: n(r?.merged),
        skipped: n(r?.skipped),
        rejected,
      },
      this.deps.clock.now().getTime(),
    );
    if (first) await checkJobCompletion(this.deps, ctx, jobId);
  }
}
