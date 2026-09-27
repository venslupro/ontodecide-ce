/**
 * @fileoverview Bindings of the ontology-manager Worker (ARCHITECTURE 2.3).
 */

/** ontology-manager environment. */
export interface Env {
  ONTOLOGY_DB: D1Database;
  ENVIRONMENT?: string;
  APP_VERSION?: string;
}
