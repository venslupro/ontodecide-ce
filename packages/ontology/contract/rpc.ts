/**
 * @fileoverview RPC contract exposed by ontology-manager (OntologyRpc
 * WorkerEntrypoint).
 */

import type {CallCtx} from '@ontodecide/shared-kernel';
import type {
  CompiledModel,
  CompiledSchema,
  DiffReport,
  DraftDto,
  OntologyPack,
  PackSummary,
  PublishReport,
  SchemaDef,
  SchemaDto,
  SchemaSummary,
} from './schema';

/** Ontology manager RPC surface. */
export interface OntologyRpc {
  listSchemas(ctx: CallCtx): Promise<SchemaSummary[]>;
  /** `version` may be a semver, `current` (default) or `draft`. */
  getSchema(ctx: CallCtx, api: string, version?: string): Promise<SchemaDto>;
  /** Compiled schema; served from KV / memory when possible. */
  getCompiledSchema(
    ctx: CallCtx,
    api: string,
    version?: string,
  ): Promise<CompiledSchema>;
  /** Merged model of all published schemas of the tenant. */
  getActiveModel(ctx: CallCtx): Promise<CompiledModel>;
  saveDraft(ctx: CallCtx, api: string, def: SchemaDef): Promise<DraftDto>;
  diff(ctx: CallCtx, api: string): Promise<DiffReport>;
  /**
   * Publishes the draft. Breaking changes require a major version bump;
   * pass `confirmVersion` equal to the new version to confirm.
   */
  publish(
    ctx: CallCtx,
    api: string,
    opts?: {confirmVersion?: string},
  ): Promise<PublishReport>;
  listPacks(ctx: CallCtx): Promise<PackSummary[]>;
  getPack(ctx: CallCtx, id: string): Promise<OntologyPack>;
  /** Imports a pack (by id or inline) and publishes its schema. */
  importPack(
    ctx: CallCtx,
    input: {packId?: string; pack?: OntologyPack},
  ): Promise<{report: PublishReport; pack: OntologyPack}>;
  exportPack(ctx: CallCtx, api: string): Promise<OntologyPack>;
  /** Evaluates a declarative function against an object's properties. */
  evaluateFunction(
    ctx: CallCtx,
    fn: string,
    props: Record<string, unknown>,
  ): Promise<unknown>;
}
