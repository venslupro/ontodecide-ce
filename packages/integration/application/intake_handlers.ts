/**
 * @fileoverview Intake use cases: presigned raw-file upload, client batch
 * submission and webhook acceptance.
 */

import {AppError, parseOrThrow, systemCtx} from '@ontodecide/shared-kernel';
import type {CallCtx} from '@ontodecide/shared-kernel';
import type {TxnType, WebhookSourceConfig} from '../contract';
import {batchInputSchema, INGEST_LIMITS, presignInputSchema} from '../contract';
import {extractItems, verifyWebhookSignature} from '../domain';
import {
  assertSourceActive,
  createJob,
  enqueueAll,
  enqueueBatch,
} from './job_progress';
import type {AppDeps} from './ports';
import {requireRole} from './views';

/** Presigned URL lifetime (15 minutes). */
export const PRESIGN_EXPIRES_SEC = 900;

function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'upload';
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned === '' ? 'upload' : cleaned.slice(0, 200);
}

/** Creates the job and a presigned PUT URL for archiving the raw file. */
export class PresignUpload {
  constructor(private readonly deps: AppDeps) {}
  async execute(
    ctx: CallCtx,
    sourceId: string,
    fileName: string,
    bytes: number,
  ): Promise<{url: string; key: string; expiresAt: string; jobId: string}> {
    requireRole(ctx, 'Operator');
    const input = parseOrThrow(presignInputSchema, {fileName, bytes});
    const source = await this.deps.sources.get(ctx, sourceId);
    assertSourceActive(source);
    const jobId = this.deps.newId();
    const key = `raw/${ctx.tenantId}/${sourceId}/${jobId}/${safeFileName(input.fileName)}`;
    const presigned = await this.deps.presigner.presignPut(
      key,
      input.bytes,
      PRESIGN_EXPIRES_SEC,
    );
    const job = await createJob(this.deps, ctx, sourceId, 'APPEND', {
      id: jobId,
      b2Key: key,
    });
    return {
      url: presigned.url,
      key,
      expiresAt: presigned.expiresAt,
      jobId: job.id,
    };
  }
}

/** Accepts one client batch (≤ 500 records) and enqueues it. */
export class SubmitBatch {
  constructor(private readonly deps: AppDeps) {}
  async execute(
    ctx: CallCtx,
    sourceId: string,
    batch: {
      jobId?: string;
      seq: number;
      last: boolean;
      records: Record<string, unknown>[];
      txnType?: TxnType;
    },
  ): Promise<{jobId: string; queuedMessages: number}> {
    requireRole(ctx, 'Operator');
    if (
      Array.isArray(batch?.records) &&
      batch.records.length > INGEST_LIMITS.batchRecordsMax
    ) {
      throw new AppError(
        'BATCH_TOO_LARGE',
        `A batch holds at most ${INGEST_LIMITS.batchRecordsMax} records`,
      );
    }
    const input = parseOrThrow(batchInputSchema, batch);
    const source = await this.deps.sources.get(ctx, sourceId);
    assertSourceActive(source);
    let job;
    if (input.jobId) {
      job = await this.deps.jobs.get(ctx, input.jobId);
      if (!job || job.sourceId !== sourceId)
        throw new AppError('NOT_FOUND', 'Job not found');
      if (job.finishedAt !== null) {
        const dup = await this.deps.jobs.findBatch(ctx, job.id, input.seq);
        if (dup) return {jobId: job.id, queuedMessages: dup.messages};
        throw new AppError('CONFLICT', 'Job already finished');
      }
    } else {
      job = await createJob(
        this.deps,
        ctx,
        sourceId,
        input.txnType ?? 'APPEND',
      );
    }
    const queuedMessages = await enqueueBatch(this.deps, ctx, job, input);
    return {jobId: job.id, queuedMessages};
  }
}

/** Verifies and enqueues a webhook delivery. */
export class AcceptWebhook {
  constructor(private readonly deps: AppDeps) {}
  async execute(
    sourceId: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<{accepted: number; jobId: string}> {
    const source = await this.deps.sources.findForWebhook(sourceId);
    if (!source || source.kind !== 'webhook')
      throw new AppError('SOURCE_NOT_FOUND');
    const secrets = source.secretEnc
      ? await this.deps.cipher.open(source.secretEnc)
      : {};
    if (!secrets.webhookSecret)
      throw new AppError('SIGNATURE_INVALID', 'No webhook secret');
    const now = this.deps.clock.now();
    const check = await verifyWebhookSignature({
      secret: secrets.webhookSecret,
      headers,
      body,
      now,
    });
    if (!check.ok) throw new AppError('SIGNATURE_INVALID', check.reason);
    if (
      !(await this.deps.nonces.claim(check.signature, sourceId, now.getTime()))
    ) {
      throw new AppError('REPLAY', 'Signature already used');
    }
    assertSourceActive(source);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new AppError('VALIDATION_FAILED', 'Body is not valid JSON');
    }
    const cfg = source.config as WebhookSourceConfig;
    const items = cfg.itemsPath
      ? extractItems(parsed, cfg.itemsPath)
      : Array.isArray(parsed)
        ? parsed
        : [parsed];
    const records = items.filter(
      (r): r is Record<string, unknown> =>
        !!r && typeof r === 'object' && !Array.isArray(r),
    );
    if (records.length > INGEST_LIMITS.batchRecordsMax) {
      throw new AppError(
        'BATCH_TOO_LARGE',
        `At most ${INGEST_LIMITS.batchRecordsMax} records`,
      );
    }
    const ctx = systemCtx(source.tenantId, `webhook:${sourceId}`);
    const job = await createJob(this.deps, ctx, sourceId, 'APPEND');
    await enqueueAll(this.deps, ctx, job, records);
    return {accepted: records.length, jobId: job.id};
  }
}
