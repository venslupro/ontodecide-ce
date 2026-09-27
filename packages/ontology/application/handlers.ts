/**
 * @fileoverview Assembles the ontology use cases behind the OntologyRpc
 * contract. The built-in template is seeded into `ont_template` on the
 * first call of each isolate.
 */

import type {CallCtx} from '@ontodecide/shared-kernel';
import type {OntologyRpc} from '../contract';
import {DEFAULT_TEMPLATE} from '../domain';
import {deleteDefinition, putDefinition} from './change_definition';
import {getCompiledSchema} from './get_compiled_schema';
import {
  getDefinition,
  getOntology,
  getTemplateSeeds,
  listDefinitions,
} from './get_schema';
import type {OntologyDeps} from './ports';
import {TemplateSeeder} from './support';

/** The ontology use cases (same surface as the RPC contract). */
export type OntologyHandlers = OntologyRpc;

/** Creates the use-case handlers. */
export function createOntologyHandlers(deps: OntologyDeps): OntologyHandlers {
  const seeder = new TemplateSeeder(deps.templates, deps.logger);
  const seeded = () => seeder.ensure(DEFAULT_TEMPLATE);
  return {
    async getCompiledSchema(ctx: CallCtx) {
      await seeded();
      return getCompiledSchema(deps, ctx);
    },
    async getOntology(ctx) {
      await seeded();
      return getOntology(deps, ctx);
    },
    async getTemplateSeeds(templateId) {
      await seeded();
      return getTemplateSeeds(templateId);
    },
    async listDefinitions(ctx, kind) {
      await seeded();
      return listDefinitions(deps, ctx, kind);
    },
    async getDefinition(ctx, kind, id) {
      await seeded();
      return getDefinition(deps, ctx, kind, id);
    },
    async putDefinition(ctx, kind, id, def, ifMatch) {
      await seeded();
      return putDefinition(deps, ctx, kind, id, def, ifMatch);
    },
    async deleteDefinition(ctx, kind, id, ifMatch) {
      await seeded();
      return deleteDefinition(deps, ctx, kind, id, ifMatch);
    },
  };
}
