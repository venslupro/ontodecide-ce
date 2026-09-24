/**
 * @fileoverview RPC handler object implementing IntegrationRpc on top of
 * the use-case handlers. Role checks live in the handlers (defense in depth
 * behind the gateway's RBAC).
 */

import {
  AcceptWebhook,
  CreateSource,
  DataHealth,
  DeleteSource,
  GetJob,
  GetSource,
  ListJobs,
  ListRejected,
  ListSources,
  PauseSourcesForTypes,
  PresignUpload,
  ReplayRejected,
  ReportWriteResult,
  SubmitBatch,
  UpdateSource,
} from '../application';
import type {AppDeps} from '../application';
import type {IntegrationRpc} from '../contract';

/** Builds the IntegrationRpc implementation. */
export function createIntegrationRpc(deps: AppDeps): IntegrationRpc {
  const listSources = new ListSources(deps);
  const getSource = new GetSource(deps);
  const createSource = new CreateSource(deps);
  const updateSource = new UpdateSource(deps);
  const deleteSource = new DeleteSource(deps);
  const presignUpload = new PresignUpload(deps);
  const submitBatch = new SubmitBatch(deps);
  const acceptWebhook = new AcceptWebhook(deps);
  const listJobs = new ListJobs(deps);
  const getJob = new GetJob(deps);
  const listRejected = new ListRejected(deps);
  const replayRejected = new ReplayRejected(deps);
  const reportWriteResult = new ReportWriteResult(deps);
  const dataHealth = new DataHealth(deps);
  const pauseSourcesForTypes = new PauseSourcesForTypes(deps);
  return {
    listSources: ctx => listSources.execute(ctx),
    getSource: (ctx, id) => getSource.execute(ctx, id),
    createSource: (ctx, def) => createSource.execute(ctx, def),
    updateSource: (ctx, id, patch) => updateSource.execute(ctx, id, patch),
    deleteSource: (ctx, id) => deleteSource.execute(ctx, id),
    presignUpload: (ctx, sourceId, fileName, bytes) =>
      presignUpload.execute(ctx, sourceId, fileName, bytes),
    submitBatch: (ctx, sourceId, batch) =>
      submitBatch.execute(ctx, sourceId, batch),
    acceptWebhook: (sourceId, headers, body) =>
      acceptWebhook.execute(sourceId, headers, body),
    listJobs: (ctx, filter) => listJobs.execute(ctx, filter),
    getJob: (ctx, jobId) => getJob.execute(ctx, jobId),
    listRejected: (ctx, jobId) => listRejected.execute(ctx, jobId),
    replayRejected: (ctx, jobId, fixes) =>
      replayRejected.execute(ctx, jobId, fixes),
    reportWriteResult: (ctx, jobId, seq, last, r) =>
      reportWriteResult.execute(ctx, jobId, seq, last, r),
    dataHealth: ctx => dataHealth.execute(ctx),
    pauseSourcesForTypes: (ctx, objectTypes) =>
      pauseSourcesForTypes.execute(ctx, objectTypes),
  };
}
