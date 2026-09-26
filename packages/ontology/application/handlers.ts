/**
 * @fileoverview Wires every ontology use-case handler from its ports.
 */

import {PackRegistry} from '../domain';
import {ActiveModelLoader, GetActiveModelHandler} from './active_model';
import {DiffHandler} from './diff_schema';
import {EvaluateFunctionHandler} from './evaluate_function';
import {GetCompiledSchemaHandler} from './get_compiled_schema';
import {GetSchemaHandler} from './get_schema';
import {ListSchemasHandler} from './list_schemas';
import {
  ExportPackHandler,
  GetPackHandler,
  ImportPackHandler,
  ListPacksHandler,
} from './packs';
import type {OntologyDeps} from './ports';
import {PublishHandler} from './publish';
import {SaveDraftHandler} from './save_draft';

/** All ontology use-case handlers. */
export interface OntologyHandlers {
  listSchemas: ListSchemasHandler;
  getSchema: GetSchemaHandler;
  getCompiledSchema: GetCompiledSchemaHandler;
  getActiveModel: GetActiveModelHandler;
  saveDraft: SaveDraftHandler;
  diff: DiffHandler;
  publish: PublishHandler;
  listPacks: ListPacksHandler;
  getPack: GetPackHandler;
  importPack: ImportPackHandler;
  exportPack: ExportPackHandler;
  evaluateFunction: EvaluateFunctionHandler;
}

/** Builds the handlers; `registry` defaults to the built-in packs. */
export function createOntologyHandlers(
  deps: OntologyDeps,
  registry: PackRegistry = new PackRegistry(),
): OntologyHandlers {
  const models = new ActiveModelLoader(deps);
  const saveDraft = new SaveDraftHandler(deps);
  const publish = new PublishHandler(deps, models);
  const getPack = new GetPackHandler(deps, registry);
  return {
    listSchemas: new ListSchemasHandler(deps),
    getSchema: new GetSchemaHandler(deps),
    getCompiledSchema: new GetCompiledSchemaHandler(deps),
    getActiveModel: new GetActiveModelHandler(models),
    saveDraft,
    diff: new DiffHandler(deps),
    publish,
    listPacks: new ListPacksHandler(deps, registry),
    getPack,
    importPack: new ImportPackHandler(
      deps,
      registry,
      getPack,
      saveDraft,
      publish,
    ),
    exportPack: new ExportPackHandler(deps, registry),
    evaluateFunction: new EvaluateFunctionHandler(models),
  };
}
