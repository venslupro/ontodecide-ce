/**
 * @fileoverview Input validation of situation use cases (REST bodies are
 * parsed with the contract schemas; the room re-checks ontology references).
 */

import {AppError, type CallCtx, parseOrThrow} from '@ontodecide/shared-kernel';
import {automationDefSchema} from '../contract/schemas';
import type {AutomationDef} from '../contract/types';
import type {OntologyPort} from './ports';

/** Parses an automation definition (VALIDATION_FAILED on mismatch). */
export function parseAutomationDef(input: unknown): AutomationDef {
  return parseOrThrow(automationDefSchema, input) as AutomationDef;
}

/** Rejects rules on object types the workspace ontology does not have. */
export async function checkObjectType(
  ontology: OntologyPort,
  ctx: CallCtx,
  objectType: string,
): Promise<void> {
  const schema = await ontology.getCompiledSchema(ctx);
  if (!schema.objectTypes[objectType]) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Unknown object type ${objectType}`,
      {
        extras: {
          errors: [{path: 'objectType', message: 'Unknown object type'}],
        },
      },
    );
  }
}
