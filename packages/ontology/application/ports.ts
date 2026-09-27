/**
 * @fileoverview Ports of the ontology application layer.
 */

import type {Clock, Logger} from '@ontodecide/shared-kernel';
import type {CompiledSchema, OntologyDef} from '../contract';
import type {Template} from '../domain';

/** The copy-on-write schema of one workspace. */
export interface WorkspaceSchemaRow {
  templateId: string;
  templateVersion: string;
  definition: OntologyDef;
  /** Stored compiled form; null when unreadable (recompiled on load). */
  compiled: CompiledSchema | null;
  etag: number;
  updatedAt: number;
}

/** Cheap lookup deciding whether the cached compiled form is current. */
export interface SchemaHead {
  tombstoned: boolean;
  /** Etag of the workspace copy; null while the template is referenced. */
  etag: number | null;
}

/** Current state of a workspace ontology. */
export interface SchemaSnapshot {
  tombstoned: boolean;
  row: WorkspaceSchemaRow | null;
}

/** New definition and compiled form to persist. */
export interface SchemaWrite {
  templateId: string;
  templateVersion: string;
  definition: OntologyDef;
  compiled: CompiledSchema;
  updatedAt: number;
}

/** Workspace-scoped schema store (bound to one tid). */
export interface WorkspaceSchemaStore {
  head(): Promise<SchemaHead>;
  load(): Promise<SchemaSnapshot>;
  /**
   * Inserts the first copy with etag 1. Returns false when a copy already
   * exists (a concurrent first change won).
   */
  insertCopy(write: SchemaWrite): Promise<boolean>;
  /**
   * Replaces the copy with `etag = etag + 1 WHERE etag = ifMatch`. Returns
   * false on an etag mismatch.
   */
  update(write: SchemaWrite, ifMatch: number): Promise<boolean>;
}

/** Opens the schema store of a workspace. */
export type WorkspaceSchemaStoreFactory = (tid: string) => WorkspaceSchemaStore;

/** Shared read-only template table (`ont_template`). */
export interface TemplateStore {
  /** Inserts the template when missing (INSERT … ON CONFLICT DO NOTHING). */
  ensure(template: Template, compiled: CompiledSchema): Promise<void>;
}

/** Cross-workspace store used only by TenantLifecycle. */
export interface LifecycleStore {
  load(tid: string): Promise<SchemaSnapshot>;
  count(tid: string): Promise<number>;
  /**
   * Deletes the workspace copy and writes the local tombstone in one batch;
   * returns the rows deleted. Also sweeps tombstones older than 48 h.
   */
  purge(tid: string, nowMs: number): Promise<number>;
}

/** Isolate-memory cache of compiled schemas keyed by (tid, etag). */
export interface CompiledCache {
  get(tid: string, etag: number): CompiledSchema | undefined;
  set(tid: string, etag: number, compiled: CompiledSchema): void;
}

/** Dependencies of the ontology use cases. */
export interface OntologyDeps {
  schemas: WorkspaceSchemaStoreFactory;
  templates: TemplateStore;
  cache: CompiledCache;
  clock: Clock;
  logger: Logger;
}
