/**
 * @fileoverview patchObject use case: RFC 7396 merge patch of properties,
 * validated against the ontology, committed with a version-guarded UPDATE
 * (If-Match, else PRECONDITION_FAILED) and one ObjectPatched outbox row.
 */

import {AppError, isRid} from '@ontodecide/shared-kernel';
import type {CallCtx, Rid} from '@ontodecide/shared-kernel';
import {validateProps} from '@ontodecide/ontology/contract';
import type {PropError} from '@ontodecide/ontology/contract';
import type {MergePatch, ObjectDto} from '../contract/types';
import {
  indexEntries,
  patchProps,
  propsHash,
  titleOf,
  toObjectDto,
} from '../domain';
import type {GraphDeps} from './ports';
import {deliver, outboxRow} from './support';

function invalid(errors: Pick<PropError, 'prop' | 'code'>[]): never {
  throw new AppError('VALIDATION_FAILED', 'Invalid properties', {
    extras: {errors: errors.map(e => ({prop: e.prop, code: e.code}))},
  });
}

/** Merge-patches an object's properties when `ifMatch` is its version. */
export async function patchObject(
  deps: GraphDeps,
  ctx: CallCtx,
  rid: Rid,
  patch: MergePatch,
  ifMatch: number,
): Promise<ObjectDto> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new AppError('VALIDATION_FAILED', 'Body must be a JSON object');
  }
  if (!Number.isInteger(ifMatch)) {
    throw new AppError('PRECONDITION_FAILED', 'If-Match is required');
  }
  if (!isRid(rid)) throw new AppError('NOT_FOUND');
  const repos = deps.repos(ctx.tid);
  const [cur, schema] = await Promise.all([
    repos.reader.get(rid),
    deps.schema.get(ctx),
  ]);
  if (!cur) throw new AppError('NOT_FOUND');
  if (cur.version !== ifMatch) {
    throw new AppError('PRECONDITION_FAILED', 'Version mismatch', {
      extras: {currentVersion: cur.version},
    });
  }
  const type = schema.objectTypes[cur.type];
  if (!type) throw new AppError('VALIDATION_FAILED', 'Unknown object type');

  const unknown = Object.keys(patch).filter(k => !type.propsByName[k]);
  if (unknown.length) {
    invalid(unknown.map(prop => ({prop, code: 'UNKNOWN_PROPERTY'})));
  }
  const values: Record<string, unknown> = {};
  const errors: Pick<PropError, 'prop' | 'code'>[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v !== null) values[k] = v;
  }
  const checked = validateProps(type, values, {partial: true});
  errors.push(...checked.errors);
  if (errors.length) invalid(errors);
  const coerced: Record<string, unknown> = {};
  for (const k of Object.keys(patch)) {
    coerced[k] = k in checked.props ? checked.props[k] : null;
    if (coerced[k] === null && type.propsByName[k].required) {
      errors.push({prop: k, code: 'REQUIRED'});
    }
  }
  if (errors.length) invalid(errors);
  if (
    type.primaryKey in coerced &&
    String(coerced[type.primaryKey]) !== cur.primaryKey
  ) {
    throw new AppError(
      'VALIDATION_FAILED',
      'The primary key cannot be changed',
      {extras: {errors: [{prop: type.primaryKey, code: 'TYPE'}]}},
    );
  }

  const outcome = patchProps(
    {props: cur.props, provenance: cur.provenance},
    coerced,
  );
  if (!outcome.changed.length) return toObjectDto(schema, cur);

  const nowMs = deps.clock.now().getTime();
  const title = titleOf(type, outcome.state.props, cur.primaryKey);
  const hash = await propsHash(outcome.state.props);
  const row = outboxRow(ctx.tid, nowMs, 'ObjectPatched', [
    {rid: cur.rid, type: cur.type, changed: outcome.changed},
  ]);
  const res = await repos.writer.commitPatch(
    {
      rid: cur.rid,
      expectedVersion: cur.version,
      state: outcome.state,
      title,
      hash,
      index: indexEntries(type, outcome.state.props),
      nowMs,
    },
    row,
  );
  if (res !== 'ok') {
    throw new AppError('PRECONDITION_FAILED', 'Version mismatch');
  }
  await deliver(deps, repos, row);
  return toObjectDto(schema, {
    ...cur,
    title,
    props: outcome.state.props,
    provenance: outcome.state.provenance,
    propsHash: hash,
    version: cur.version + 1,
    updatedAt: nowMs,
  });
}
