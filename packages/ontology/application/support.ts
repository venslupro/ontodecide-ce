/**
 * @fileoverview Shared helpers of the ontology use cases: the compiled
 * built-in templates (compiled once per isolate and shared by every
 * workspace that never changed its ontology), lazy template seeding and
 * resolution of a workspace's current ontology.
 */

import type {Logger} from '@ontodecide/shared-kernel';
import type {CompiledSchema, OntologyDef} from '../contract';
import {
  compileOntology,
  DEFAULT_TEMPLATE,
  emptyOntology,
  findTemplate,
  withMeta,
  type Template,
} from '../domain';
import type {
  CompiledCache,
  SchemaSnapshot,
  TemplateStore,
  WorkspaceSchemaRow,
} from './ports';

const compiledTemplates = new Map<string, CompiledSchema>();

/** Compiled form of a template (custom = false, etag = 0), memoized. */
export function compiledTemplate(template: Template): CompiledSchema {
  const key = `${template.id}@${template.version}`;
  let compiled = compiledTemplates.get(key);
  if (!compiled) {
    compiled = compileOntology(template.definition, {
      templateId: template.id,
      templateVersion: template.version,
      custom: false,
      etag: 0,
    });
    compiledTemplates.set(key, compiled);
  }
  return compiled;
}

/** Template a stored copy was made from (falls back to the default). */
export function templateOf(row: {templateId: string} | null): Template {
  return (row && findTemplate(row.templateId)) ?? DEFAULT_TEMPLATE;
}

/**
 * Seeds `ont_template` from code once per isolate. Failures are logged and
 * retried on the next call; the template is always served from code.
 */
export class TemplateSeeder {
  private readonly done = new Set<string>();

  constructor(
    private readonly store: TemplateStore,
    private readonly logger: Logger,
  ) {}

  async ensure(template: Template): Promise<void> {
    const key = `${template.id}@${template.version}`;
    if (this.done.has(key)) return;
    try {
      await this.store.ensure(template, compiledTemplate(template));
      this.done.add(key);
    } catch (e) {
      this.logger.warn('template seed failed', {
        templateId: template.id,
        error: e instanceof Error ? e.message.slice(0, 200) : 'unknown',
      });
    }
  }
}

/** What a workspace currently sees. */
export interface ResolvedOntology {
  tombstoned: boolean;
  template: Template;
  /** Workspace copy, or null while the template is referenced. */
  row: WorkspaceSchemaRow | null;
  /** Current definition (empty for purged workspaces). */
  definition: OntologyDef;
  /** Schema etag: 0 for the template, the copy's counter otherwise. */
  etag: number;
  custom: boolean;
}

/** Resolves a snapshot to the definition the workspace sees. */
export function resolve(snapshot: SchemaSnapshot): ResolvedOntology {
  const {row, tombstoned} = snapshot;
  const template = templateOf(row);
  if (tombstoned) {
    return {
      tombstoned,
      template,
      row: null,
      definition: emptyOntology(),
      etag: 0,
      custom: false,
    };
  }
  return {
    tombstoned,
    template,
    row,
    definition: row ? row.definition : template.definition,
    etag: row ? row.etag : 0,
    custom: row !== null,
  };
}

/** Compiled form of a workspace copy, from the cache or the stored row. */
export function compiledOfRow(
  tid: string,
  row: WorkspaceSchemaRow,
  cache: CompiledCache,
): CompiledSchema {
  const cached = cache.get(tid, row.etag);
  if (cached) return cached;
  const meta = {
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    custom: true,
    etag: row.etag,
  };
  const compiled = row.compiled
    ? withMeta(row.compiled, meta)
    : compileOntology(row.definition, meta);
  cache.set(tid, row.etag, compiled);
  return compiled;
}

/** Compiled schema of a purged workspace: no types at all. */
export function emptyCompiled(template: Template): CompiledSchema {
  return compileOntology(emptyOntology(), {
    templateId: template.id,
    templateVersion: template.version,
    custom: false,
    etag: 0,
  });
}
