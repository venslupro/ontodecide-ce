/**
 * @fileoverview Merges a tenant's published compiled schemas into the active
 * model.
 */

import {sha256Hex} from '@ontodecide/shared-kernel';
import type {CompiledModel, CompiledSchema} from '../contract';

/** Version string of an empty model. */
export const EMPTY_MODEL_VERSION = '0';

/**
 * Merges compiled schemas (one per api). Api names are unique across a
 * tenant's schemas (enforced at publish); on a clash the schema that sorts
 * last wins. An empty list yields an empty model with version `0`.
 */
export async function mergeModel(
  tenantId: string,
  schemas: readonly CompiledSchema[],
): Promise<CompiledModel> {
  const sorted = [...schemas].sort((a, b) =>
    a.apiName < b.apiName ? -1 : a.apiName > b.apiName ? 1 : 0,
  );
  const model: CompiledModel = {
    tenantId,
    version: sorted.length
      ? sorted.map(s => `${s.apiName}@${s.version}`).join('+')
      : EMPTY_MODEL_VERSION,
    hash: '',
    schemas: sorted.map(s => ({apiName: s.apiName, version: s.version})),
    objectTypes: {},
    linkTypes: {},
    actionTypes: {},
    functions: {},
    simulationKpis: [],
    indexPlan: [],
  };
  for (const s of sorted) {
    Object.assign(model.objectTypes, s.objectTypes);
    Object.assign(model.linkTypes, s.linkTypes);
    Object.assign(model.actionTypes, s.actionTypes);
    Object.assign(model.functions, s.functions);
    model.simulationKpis.push(...s.simulationKpis);
    model.indexPlan.push(...s.indexPlan);
  }
  model.hash = await sha256Hex(
    sorted.map(s => `${s.apiName}@${s.version}:${s.hash}`).join('\n'),
  );
  return model;
}
