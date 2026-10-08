/**
 * @fileoverview Registry of built-in templates. A workspace starts from the
 * BLANK_TEMPLATE (no scenario loaded); the six example scenarios are peers
 * the user explicitly loads via setTemplate. Templates live in code and are
 * seeded into `ont_template` on first use.
 */

import {
  BLANK_TEMPLATE_ID,
  SUPPLY_CHAIN_TEMPLATE_ID,
  URBAN_EMERGENCY_TEMPLATE_ID,
  PREDICTIVE_MAINTENANCE_TEMPLATE_ID,
  FINANCIAL_FRAUD_TEMPLATE_ID,
  ENERGY_GRID_TEMPLATE_ID,
  INTELLIGENCE_FUSION_TEMPLATE_ID,
} from '../contract';
import type {OntologyDef, TemplateSeeds} from '../contract';
import {
  BLANK_DEFINITION,
  BLANK_SEEDS,
  BLANK_TEMPLATE_VERSION,
} from './packs/blank';
import {
  SUPPLY_CHAIN_DEFINITION,
  SUPPLY_CHAIN_SEEDS,
  SUPPLY_CHAIN_TEMPLATE_VERSION,
} from './packs/supply_chain';
import {
  URBAN_EMERGENCY_DEFINITION,
  URBAN_EMERGENCY_SEEDS,
  URBAN_EMERGENCY_TEMPLATE_VERSION,
} from './packs/urban_emergency';
import {
  PREDICTIVE_MAINTENANCE_DEFINITION,
  PREDICTIVE_MAINTENANCE_SEEDS,
  PREDICTIVE_MAINTENANCE_TEMPLATE_VERSION,
} from './packs/predictive_maintenance';
import {
  FINANCIAL_FRAUD_DEFINITION,
  FINANCIAL_FRAUD_SEEDS,
  FINANCIAL_FRAUD_TEMPLATE_VERSION,
} from './packs/financial_fraud';
import {
  ENERGY_GRID_DEFINITION,
  ENERGY_GRID_SEEDS,
  ENERGY_GRID_TEMPLATE_VERSION,
} from './packs/energy_grid';
import {
  INTELLIGENCE_FUSION_DEFINITION,
  INTELLIGENCE_FUSION_SEEDS,
  INTELLIGENCE_FUSION_TEMPLATE_VERSION,
} from './packs/intelligence_fusion';

/** A built-in template. */
export interface Template {
  id: string;
  version: string;
  definition: OntologyDef;
  seeds: TemplateSeeds;
}

/**
 * Template new workspaces start from: BLANK (no scenario loaded).
 * A workspace acquires a concrete business-scenario ontology only when the
 * user explicitly loads one via setTemplate.
 */
export const DEFAULT_TEMPLATE: Template = {
  id: BLANK_TEMPLATE_ID,
  version: BLANK_TEMPLATE_VERSION,
  definition: BLANK_DEFINITION,
  seeds: BLANK_SEEDS,
};

/** Every built-in template: blank default + six example scenarios. */
export const BUILT_IN_TEMPLATES: readonly Template[] = [
  DEFAULT_TEMPLATE,
  {
    id: SUPPLY_CHAIN_TEMPLATE_ID,
    version: SUPPLY_CHAIN_TEMPLATE_VERSION,
    definition: SUPPLY_CHAIN_DEFINITION,
    seeds: SUPPLY_CHAIN_SEEDS,
  },
  {
    id: URBAN_EMERGENCY_TEMPLATE_ID,
    version: URBAN_EMERGENCY_TEMPLATE_VERSION,
    definition: URBAN_EMERGENCY_DEFINITION,
    seeds: URBAN_EMERGENCY_SEEDS,
  },
  {
    id: PREDICTIVE_MAINTENANCE_TEMPLATE_ID,
    version: PREDICTIVE_MAINTENANCE_TEMPLATE_VERSION,
    definition: PREDICTIVE_MAINTENANCE_DEFINITION,
    seeds: PREDICTIVE_MAINTENANCE_SEEDS,
  },
  {
    id: FINANCIAL_FRAUD_TEMPLATE_ID,
    version: FINANCIAL_FRAUD_TEMPLATE_VERSION,
    definition: FINANCIAL_FRAUD_DEFINITION,
    seeds: FINANCIAL_FRAUD_SEEDS,
  },
  {
    id: ENERGY_GRID_TEMPLATE_ID,
    version: ENERGY_GRID_TEMPLATE_VERSION,
    definition: ENERGY_GRID_DEFINITION,
    seeds: ENERGY_GRID_SEEDS,
  },
  {
    id: INTELLIGENCE_FUSION_TEMPLATE_ID,
    version: INTELLIGENCE_FUSION_TEMPLATE_VERSION,
    definition: INTELLIGENCE_FUSION_DEFINITION,
    seeds: INTELLIGENCE_FUSION_SEEDS,
  },
];

/** Returns a built-in template by id, or null. */
export function findTemplate(id: string): Template | null {
  return BUILT_IN_TEMPLATES.find(t => t.id === id) ?? null;
}
