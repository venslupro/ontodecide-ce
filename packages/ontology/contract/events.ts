/**
 * @fileoverview Events published by ontology-manager.
 */

import type {IndexPlanEntry} from './schema';

/** Emitted after a schema version is published. */
export interface OntologyPublished {
  api: string;
  version: string;
  breaking: boolean;
  indexChanges: IndexPlanEntry[];
}
