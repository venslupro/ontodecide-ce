/**
 * @fileoverview RPC contract of ontology-manager (OntologyRpc entry point).
 * No dependencies on other services.
 */

import type {CallCtx} from '@ontodecide/shared-kernel';
import type {
  CompiledSchema,
  DefByKind,
  DefKind,
  OntologyDto,
  TemplateSeeds,
} from './schema';

/** A definition with the schema version it was read at. */
export interface DefinitionResult<K extends DefKind> {
  item: DefByKind[K];
  etag: number;
}

/** A definition collection with the schema version. */
export interface DefinitionList<K extends DefKind> {
  items: DefByKind[K][];
  etag: number;
  custom: boolean;
}

/** ontology-manager RPC surface. */
export interface OntologyRpc {
  /**
   * Compiled ontology of the workspace (the template until the first
   * change). Cached in isolate memory by (tid, etag).
   */
  getCompiledSchema(ctx: CallCtx): Promise<CompiledSchema>;
  /** Whole ontology for the workbench. */
  getOntology(ctx: CallCtx): Promise<OntologyDto>;
  /** Template KPI and automation seeds. */
  getTemplateSeeds(templateId: string): Promise<TemplateSeeds>;
  listDefinitions<K extends DefKind>(
    ctx: CallCtx,
    kind: K,
  ): Promise<DefinitionList<K>>;
  /** NOT_FOUND when the definition does not exist. */
  getDefinition<K extends DefKind>(
    ctx: CallCtx,
    kind: K,
    id: string,
  ): Promise<DefinitionResult<K>>;
  /**
   * Creates (`id` absent in the ontology) or replaces a definition. The
   * first change copies the template. `ifMatch` is the schema etag;
   * mismatch → PRECONDITION_FAILED; structural errors → VALIDATION_FAILED.
   */
  putDefinition<K extends DefKind>(
    ctx: CallCtx,
    kind: K,
    id: string,
    def: DefByKind[K],
    ifMatch: number,
  ): Promise<{etag: number}>;
  /** Removes a definition (and dangling references are rejected). */
  deleteDefinition(
    ctx: CallCtx,
    kind: DefKind,
    id: string,
    ifMatch: number,
  ): Promise<{etag: number}>;
}
