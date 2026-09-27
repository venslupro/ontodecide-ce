/**
 * @fileoverview Registry of the built-in shared read-only templates. CE
 * ships exactly one ("supply chain risk"); templates live in code and are
 * seeded into `ont_template` on first use.
 */

import {SUPPLY_CHAIN_TEMPLATE_ID} from '../contract';
import type {OntologyDef, TemplateSeeds} from '../contract';
import {
  SUPPLY_CHAIN_DEFINITION,
  SUPPLY_CHAIN_SEEDS,
  SUPPLY_CHAIN_TEMPLATE_VERSION,
} from './packs/supply_chain';

/** A built-in template. */
export interface Template {
  id: string;
  version: string;
  definition: OntologyDef;
  seeds: TemplateSeeds;
}

/** Template new workspaces start from. */
export const DEFAULT_TEMPLATE: Template = {
  id: SUPPLY_CHAIN_TEMPLATE_ID,
  version: SUPPLY_CHAIN_TEMPLATE_VERSION,
  definition: SUPPLY_CHAIN_DEFINITION,
  seeds: SUPPLY_CHAIN_SEEDS,
};

/** Every built-in template. */
export const BUILT_IN_TEMPLATES: readonly Template[] = [DEFAULT_TEMPLATE];

/** Returns a built-in template by id, or null. */
export function findTemplate(id: string): Template | null {
  return BUILT_IN_TEMPLATES.find(t => t.id === id) ?? null;
}
