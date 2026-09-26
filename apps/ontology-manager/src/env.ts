/**
 * @fileoverview Bindings of the ontology-manager Worker.
 */

/** ontology-manager environment. */
export interface Env {
  ONTOLOGY_DB: D1Database;
  SCHEMA_CACHE: KVNamespace;
  ENVIRONMENT?: string;
}
