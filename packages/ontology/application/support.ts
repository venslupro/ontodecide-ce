/**
 * @fileoverview Helpers shared by the ontology use-case handlers.
 */

import {AppError} from '@ontodecide/shared-kernel';
import type {CompiledSchema, SchemaDef, SchemaDto} from '../contract';
import {compileSchema, isSemver} from '../domain';
import {DRAFT_VERSION, type SchemaRecord} from './ports';

/** Version selector accepted by getSchema / getCompiledSchema. */
export type VersionSelector = 'current' | 'draft' | string;

/** Normalizes a version selector; throws VALIDATION_FAILED when malformed. */
export function resolveVersion(version?: string): VersionSelector {
  const v = version === undefined || version === '' ? 'current' : version;
  if (v === 'current' || v === DRAFT_VERSION || isSemver(v)) return v;
  throw new AppError(
    'VALIDATION_FAILED',
    `Invalid version: ${v} (expected current, draft or MAJOR.MINOR.PATCH)`,
  );
}

/** Converts epoch milliseconds to ISO-8601. */
export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Maps a stored row to its DTO. */
export function toSchemaDto(r: SchemaRecord): SchemaDto {
  return {
    apiName: r.apiName,
    version: r.version,
    status: r.status,
    definition: r.definition,
    ...(r.publishedBy ? {publishedBy: r.publishedBy} : {}),
    ...(r.publishedAt !== null ? {publishedAt: iso(r.publishedAt)} : {}),
  };
}

/** Returns the stored compiled form of a row, compiling when absent. */
export async function compiledOf(r: SchemaRecord): Promise<CompiledSchema> {
  return r.compiled ?? compileSchema(r.definition, r.version);
}

/** Throws NOT_FOUND for a missing schema. */
export function schemaNotFound(api: string, version: string): never {
  throw new AppError('NOT_FOUND', `Schema ${api}@${version} not found`);
}

/** Definitions of the tenant's other published schemas. */
export function otherDefinitions(
  current: readonly SchemaRecord[],
  api: string,
): SchemaDef[] {
  return current.filter(r => r.apiName !== api).map(r => r.definition);
}
