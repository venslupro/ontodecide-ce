/**
 * @fileoverview Ports of the ontology application layer.
 */

import type {Clock, Logger} from '@ontodecide/shared-kernel';
import type {
  CompiledModel,
  CompiledSchema,
  OntologyPack,
  SchemaDef,
  SchemaStatus,
} from '../contract';

/** Version key under which a tenant's draft of a schema is stored. */
export const DRAFT_VERSION = 'draft';

/** A stored schema row. */
export interface SchemaRecord {
  apiName: string;
  /** Semver for published rows, `draft` for the draft. */
  version: string;
  status: SchemaStatus;
  definition: SchemaDef;
  compiled: CompiledSchema | null;
  publishedBy: string | null;
  /** Epoch milliseconds. */
  publishedAt: number | null;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/** A light listing row (no definition). */
export interface SchemaVersionRow {
  apiName: string;
  version: string;
  status: SchemaStatus;
}

/** A published version to insert. */
export interface PublishRecord {
  apiName: string;
  version: string;
  definition: SchemaDef;
  compiled: CompiledSchema;
  publishedBy: string;
  publishedAt: number;
}

/** Persistence of schema versions and tenant packs. Every call is tenant-scoped. */
export interface SchemaRepository {
  /** All (api, version, status) rows of a tenant. */
  listVersions(tenantId: string): Promise<SchemaVersionRow[]>;
  /** Loads specific rows (missing ones are skipped). */
  getMany(
    tenantId: string,
    keys: readonly {apiName: string; version: string}[],
  ): Promise<SchemaRecord[]>;
  /** The draft of an api, if any. */
  getDraft(tenantId: string, api: string): Promise<SchemaRecord | null>;
  /** The highest published version of an api, if any. */
  getCurrent(tenantId: string, api: string): Promise<SchemaRecord | null>;
  /** A specific published version. */
  getVersion(
    tenantId: string,
    api: string,
    version: string,
  ): Promise<SchemaRecord | null>;
  /** The current published version of every api of the tenant. */
  listCurrent(tenantId: string): Promise<SchemaRecord[]>;
  /** Creates or replaces the draft. */
  saveDraft(tenantId: string, def: SchemaDef, now: number): Promise<void>;
  /**
   * Atomically inserts an immutable PUBLISHED row and deletes the draft.
   * Throws CONFLICT when the version already exists.
   */
  publish(tenantId: string, record: PublishRecord): Promise<void>;
  /** Packs imported inline by the tenant. */
  listPacks(tenantId: string): Promise<OntologyPack[]>;
  /** One tenant pack. */
  getPack(tenantId: string, id: string): Promise<OntologyPack | null>;
  /** Creates or replaces a tenant pack. */
  savePack(tenantId: string, pack: OntologyPack, now: number): Promise<void>;
}

/**
 * Compiled schema / model cache. Durable (KV) entries are written only on
 * publish; reads fill the isolate-memory tier.
 */
export interface SchemaCache {
  /** `version` is a semver or `current`. */
  getSchema(
    tenantId: string,
    api: string,
    version: string,
  ): Promise<CompiledSchema | null>;
  /** Memory-only fill after a miss. */
  putSchema(tenantId: string, version: string, schema: CompiledSchema): void;
  getModel(tenantId: string): Promise<CompiledModel | null>;
  /** Memory-only fill after a miss. */
  putModel(tenantId: string, model: CompiledModel): void;
  /** Writes the new current schema and model through to every tier. */
  onPublish(
    tenantId: string,
    schema: CompiledSchema,
    model: CompiledModel,
  ): Promise<void>;
}

/** Dependencies shared by the use-case handlers. */
export interface OntologyDeps {
  repo: SchemaRepository;
  cache: SchemaCache;
  clock: Clock;
  logger: Logger;
}
