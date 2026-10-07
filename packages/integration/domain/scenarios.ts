/**
 * @fileoverview Registry of built-in example scenarios. The system is not
 * coupled to any scenario: these six ship with the product so a new
 * workspace can be explored immediately, but users may also import their
 * own CSV / XLSX / JSON data. Each scenario bundles an ontology template
 * id and the sample datasets that populate it. Scenario metadata (names,
 * descriptions, object/link counts) lives in the contract as the single
 * source of truth; this file adds the template id and sample datasets.
 */

import {BUILT_IN_SCENARIOS, type SampleScenario} from '../contract';
import {sampleDatasets} from './sample_scenario';
import {urbanEmergencyDatasets} from './scenarios/urban_emergency';
import {predictiveMaintenanceDatasets} from './scenarios/predictive_maintenance';
import {financialFraudDatasets} from './scenarios/financial_fraud';
import {energyGridDatasets} from './scenarios/energy_grid';
import {intelligenceFusionDatasets} from './scenarios/intelligence_fusion';

/** Seed-row budgets per scenario (D1 rows reserved against the daily cap). */
const SEED_ROWS: Record<string, number> = {
  'supply-chain': 1300,
  'urban-emergency': 600,
  'predictive-maintenance': 700,
  'financial-fraud': 800,
  'energy-grid': 600,
  'intelligence-fusion': 700,
};

/** Sample-data factories keyed by scenario id. */
const DATASETS: Record<string, () => import('../contract').SampleDataset[]> = {
  'supply-chain': sampleDatasets,
  'urban-emergency': urbanEmergencyDatasets,
  'predictive-maintenance': predictiveMaintenanceDatasets,
  'financial-fraud': financialFraudDatasets,
  'energy-grid': energyGridDatasets,
  'intelligence-fusion': intelligenceFusionDatasets,
};

/**
 * All built-in example scenarios, combining the contract metadata with the
 * template id and sample datasets. Order follows BUILT_IN_SCENARIOS.
 */
export const SAMPLE_SCENARIOS: readonly SampleScenario[] =
  BUILT_IN_SCENARIOS.map(meta => ({
    ...meta,
    templateId: meta.id,
    datasets: DATASETS[meta.id],
    seedRows: SEED_ROWS[meta.id] ?? 1000,
  }));

/** Returns a built-in scenario by id, or null. */
export function getSampleScenario(id: string): SampleScenario | null {
  return SAMPLE_SCENARIOS.find(s => s.id === id) ?? null;
}
