/**
 * @fileoverview Null Object representing the "no scenario loaded" state.
 * A workspace starts from this blank template: no object types, no link
 * types, no action types, no KPI seeds, no automation seeds. Only when the
 * user explicitly loads a scenario (via setTemplate) does the workspace
 * acquire a concrete business-scenario ontology.
 *
 * This follows the Null Object Pattern: BLANK_TEMPLATE satisfies the
 * Template interface with neutral/empty values, so the resolution logic
 * (templateOf, resolve, getCompiledSchema) needs no special-casing.
 */

import type {OntologyDef, TemplateSeeds} from '../../contract';

/** Version of the blank template. */
export const BLANK_TEMPLATE_VERSION = '1.0.0';

/** Empty ontology definition: no types, links, actions, functions or KPIs. */
export const BLANK_DEFINITION: OntologyDef = {
  objectTypes: [],
  linkTypes: [],
  actionTypes: [],
  functions: [],
  simulationKpis: [],
};

/** No KPI or automation seeds. */
export const BLANK_SEEDS: TemplateSeeds = {
  kpis: [],
  automations: [],
};
