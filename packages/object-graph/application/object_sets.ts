/**
 * @fileoverview Saved Object Sets: list, save and evaluate.
 */

import {AppError, parseOrThrow, ulid} from '@ontodecide/shared-kernel';
import type {
  CallCtx,
  ObjectSetDef,
  PageRequest,
} from '@ontodecide/shared-kernel';
import {saveObjectSetInputSchema} from '../contract';
import type {ObjectPage, ObjectSetDto} from '../contract';
import {EvaluateObjectSet} from './evaluate_object_set';
import type {AppDeps} from './ports';
import {requireRole} from './support';

/** Use case: list the tenant's saved object sets. */
export class ListObjectSets {
  constructor(private readonly d: AppDeps) {}

  handle(ctx: CallCtx): Promise<ObjectSetDto[]> {
    requireRole(ctx, 'Viewer');
    return this.d.objectSets.list(ctx.tenantId);
  }
}

/** Use case: create or update a saved object set (Operator+). */
export class SaveObjectSet {
  constructor(private readonly d: AppDeps) {}

  async handle(
    ctx: CallCtx,
    input: {id?: string; name: string; definition: ObjectSetDef},
  ): Promise<ObjectSetDto> {
    requireRole(ctx, 'Operator');
    const parsed = parseOrThrow(saveObjectSetInputSchema, input);
    const model = await this.d.models.get(ctx);
    if (!model.objectTypes[parsed.definition.objectType]) {
      throw new AppError(
        'OBJECT_SET_INVALID',
        `Unknown object type ${parsed.definition.objectType}`,
      );
    }
    let id = input.id;
    let createdBy = ctx.userId;
    if (id) {
      const existing = await this.d.objectSets.get(ctx.tenantId, id);
      if (!existing) throw new AppError('NOT_FOUND', 'Object set not found');
      createdBy = existing.createdBy;
    } else {
      id = ulid(this.d.clock.now().getTime());
    }
    const dto: ObjectSetDto = {
      id,
      name: parsed.name,
      definition: parsed.definition as ObjectSetDef,
      createdBy,
      updatedAt: this.d.clock.now().toISOString(),
    };
    await this.d.objectSets.save(ctx.tenantId, dto);
    return dto;
  }
}

/** Use case: evaluate a saved object set. */
export class EvaluateSavedObjectSet {
  private readonly evaluate: EvaluateObjectSet;
  constructor(private readonly d: AppDeps) {
    this.evaluate = new EvaluateObjectSet(d);
  }

  async handle(
    ctx: CallCtx,
    id: string,
    page?: PageRequest,
  ): Promise<ObjectPage> {
    requireRole(ctx, 'Viewer');
    const set = await this.d.objectSets.get(ctx.tenantId, id);
    if (!set) throw new AppError('NOT_FOUND', 'Object set not found');
    return this.evaluate.handle(ctx, set.definition, page);
  }
}
