/**
 * @fileoverview Record → DTO conversion and small shared guards.
 */

import {AppError, hasRole} from '@ontodecide/shared-kernel';
import type {CallCtx, Role} from '@ontodecide/shared-kernel';
import type {JobDto, RawRecordDto, SourceDto} from '../contract';
import {qualityScore} from '../domain';
import type {JobRecord, RawRecordRow, SourceRecord} from './ports';

/** Throws FORBIDDEN unless the caller holds `min` (defense in depth). */
export function requireRole(ctx: CallCtx, min: Role): void {
  if (!hasRole(ctx.roles, min)) {
    throw new AppError('FORBIDDEN', `Requires role ${min}`);
  }
}

const iso = (ms: number): string => new Date(ms).toISOString();

/** Converts a stored source to its DTO (secrets never included). */
export function toSourceDto(s: SourceRecord): SourceDto {
  const config = {...s.config};
  delete config.secretHeaders;
  const dto: SourceDto = {
    id: s.id,
    tenantId: s.tenantId,
    name: s.name,
    kind: s.kind,
    config: config as unknown as SourceDto['config'],
    mapping: s.mapping,
    qualityRules: s.qualityRules,
    conflictPolicy: s.conflictPolicy,
    priority: s.priority,
    enabled: s.enabled,
    cursor: s.cursor,
    createdAt: iso(s.createdAt),
    paused: s.paused,
  };
  if (s.schedule) dto.schedule = s.schedule;
  if (s.lastJobAt) dto.lastJobAt = iso(s.lastJobAt);
  return dto;
}

/** Converts a stored job to its DTO. */
export function toJobDto(j: JobRecord): JobDto {
  const dto: JobDto = {
    id: j.id,
    tenantId: j.tenantId,
    sourceId: j.sourceId,
    txnType: j.txnType,
    status: j.status,
    received: j.received,
    upserted: j.upserted,
    merged: j.merged,
    skipped: j.skipped,
    rejected: j.rejected,
    qualityScore: j.qualityScore ?? qualityScore(j.received, j.rejected),
    startedAt: iso(j.startedAt),
    totalGroups: j.totalGroups,
    doneGroups: j.doneGroups,
  };
  if (j.b2Key) dto.b2Key = j.b2Key;
  if (j.finishedAt) dto.finishedAt = iso(j.finishedAt);
  return dto;
}

/** Converts a stored rejected record to its DTO. */
export function toRawRecordDto(r: RawRecordRow): RawRecordDto {
  const dto: RawRecordDto = {
    id: r.id,
    jobId: r.jobId,
    rowNo: r.rowNo,
    payload: r.payload,
    errorCode: r.errorCode,
    createdAt: iso(r.createdAt),
  };
  if (r.errorDetail) dto.errorDetail = r.errorDetail;
  return dto;
}
