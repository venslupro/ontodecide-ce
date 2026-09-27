/**
 * @fileoverview IntegrationRpc handler object: validates inputs with the
 * contract's zod schemas and delegates to the use cases.
 */

import {parseOrThrow} from '@ontodecide/shared-kernel';
import {z} from 'zod';
import {
  batchSchema,
  createImportSchema,
  mappingDraftSchema,
  mappingSpecSchema,
} from '../contract';
import type {IntegrationRpc, MappingSpec} from '../contract';
import {
  createImport,
  getImport,
  listImports,
  loadSample,
  mappingDraft,
  putMapping,
  submitBatch,
  usage,
} from '../application';
import type {IntegrationDeps} from '../application';

const jobIdSchema = z.string().min(1).max(64);
const pageSchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

/** Builds the IntegrationRpc implementation. */
export function createIntegrationRpc(deps: IntegrationDeps): IntegrationRpc {
  return {
    createImport: (ctx, input) =>
      createImport(deps, ctx, parseOrThrow(createImportSchema, input)),
    putMapping: (ctx, jobId, mapping) =>
      putMapping(
        deps,
        ctx,
        parseOrThrow(jobIdSchema, jobId),
        parseOrThrow(mappingSpecSchema, mapping) as MappingSpec,
      ),
    submitBatch: (ctx, jobId, batch) =>
      submitBatch(
        deps,
        ctx,
        parseOrThrow(jobIdSchema, jobId),
        parseOrThrow(batchSchema, batch),
      ),
    getImport: (ctx, jobId) =>
      getImport(deps, ctx, parseOrThrow(jobIdSchema, jobId)),
    listImports: (ctx, page) =>
      listImports(deps, ctx, parseOrThrow(pageSchema, page ?? {})),
    mappingDraft: (ctx, jobId, input) =>
      mappingDraft(
        deps,
        ctx,
        parseOrThrow(jobIdSchema, jobId),
        parseOrThrow(mappingDraftSchema, input),
      ),
    loadSample: ctx => loadSample(deps, ctx),
    usage: ctx => usage(deps, ctx),
  };
}
