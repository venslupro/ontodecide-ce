/**
 * @fileoverview applyAction use case (详细设计 6.11.3): idempotency by
 * (tenant_id, idempotency_key) → If-Match version check → parameters and
 * JSONLogic preconditions (VALIDATION_FAILED 422) → effects → one D1 batch
 * with the version-guarded update, link changes, action log and an
 * ActionExecuted outbox row. Only objects of the caller's workspace are
 * touched.
 */

import {
  AppError,
  CE_LIMITS,
  actorLabel,
  isRid,
  isServiceCtx,
  ulid,
} from '@ontodecide/shared-kernel';
import type {CallCtx, ObjectChangeRef, Rid} from '@ontodecide/shared-kernel';
import type {ActionResult, ApplyActionCmd} from '../contract/types';
import {
  actionData,
  applyEffects,
  indexEntries,
  pick,
  propsHash,
  resolveParams,
  titleOf,
  touchedLinkTypes,
  unmetPreconditions,
} from '../domain';
import type {GraphDeps} from './ports';
import {deliver, ensureNotTombstoned, outboxRow} from './support';

/** Actor labels og_action_log accepts. */
export const ACTION_ACTORS = ['owner', 'admin', 'svc:decision-engine'];

function checkKey(ctx: CallCtx, key: unknown): string {
  // Services derive keys from a client key (decision-engine: `${key}:n`),
  // so they may exceed the client bound slightly.
  const service = isServiceCtx(ctx);
  const min = service ? 1 : CE_LIMITS.idempotencyKeyMin;
  const max = service ? 128 : CE_LIMITS.idempotencyKeyMax;
  if (typeof key !== 'string' || key.length < min || key.length > max) {
    throw new AppError('VALIDATION_FAILED', 'Invalid Idempotency-Key');
  }
  return key;
}

/** Executes an action on one object of the workspace. */
export async function applyAction(
  deps: GraphDeps,
  ctx: CallCtx,
  cmd: ApplyActionCmd,
): Promise<ActionResult> {
  const key = checkKey(ctx, cmd?.idempotencyKey);
  const actor = actorLabel(ctx);
  if (!ACTION_ACTORS.includes(actor)) {
    throw new AppError('FORBIDDEN', 'This principal cannot execute actions');
  }
  if (typeof cmd.actionType !== 'string' || !isRid(cmd.target)) {
    throw new AppError('VALIDATION_FAILED', 'actionType and target required');
  }
  const repos = deps.repos(ctx.tid);

  const replay = async (): Promise<ActionResult | null> => {
    const prior = await repos.actions.findByKey(key);
    if (!prior) return null;
    if (prior.actionType !== cmd.actionType || prior.targetRid !== cmd.target) {
      throw new AppError(
        'CONFLICT',
        'Idempotency-Key was used for another request',
      );
    }
    return {...prior.result, replayed: true};
  };
  const first = await replay();
  if (first) return first;

  const [schema, target, counts] = await Promise.all([
    deps.schema.get(ctx),
    repos.reader.get(cmd.target),
    repos.reader.counts(),
  ]);
  ensureNotTombstoned(counts.tombstoned);
  const action = schema.actionTypes[cmd.actionType];
  if (!action) throw new AppError('NOT_FOUND', 'Unknown action type');
  if (!target) throw new AppError('NOT_FOUND');
  const type = schema.objectTypes[target.type];
  if (target.type !== action.targetType || !type) {
    throw new AppError('VALIDATION_FAILED', 'Target type does not match');
  }
  if (cmd.ifMatch === undefined || cmd.ifMatch === null) {
    if (!isServiceCtx(ctx)) {
      throw new AppError('PRECONDITION_FAILED', 'If-Match is required');
    }
  } else if (cmd.ifMatch !== target.version) {
    throw new AppError('PRECONDITION_FAILED', 'Version mismatch', {
      extras: {currentVersion: target.version},
    });
  }

  const {params, refs} = resolveParams(action, cmd.params ?? {});
  const refTypes = new Map<string, string>();
  if (refs.length) {
    const found = await repos.reader.getMany(refs.map(r => r.rid));
    for (const o of found) refTypes.set(o.rid, o.type);
    const bad = refs.filter(r => refTypes.get(r.rid) !== r.objectType);
    if (bad.length) {
      throw new AppError('VALIDATION_FAILED', 'Referenced object not found', {
        extras: {errors: bad.map(r => ({prop: r.param, code: 'REF_MISSING'}))},
      });
    }
  }

  const unmet = unmetPreconditions(
    action,
    actionData(target, params),
    ctx.locale,
  );
  if (unmet.length) {
    throw new AppError('VALIDATION_FAILED', 'Preconditions not met', {
      status: 422,
      extras: {unmet},
    });
  }

  const touched = touchedLinkTypes(action);
  const links = touched.length
    ? await repos.traversal.linksOf(target.rid, touched)
    : [];
  const plan = applyEffects({
    schema,
    action,
    type,
    target,
    params,
    links,
    refTypes,
  });
  if (
    counts.links - plan.removeLinks.length + plan.addLinks.length >
      deps.caps.maxLinks &&
    plan.addLinks.length > plan.removeLinks.length
  ) {
    throw new AppError('QUOTA_EXCEEDED', 'LINK_LIMIT');
  }

  const nowMs = deps.clock.now().getTime();
  const id = ulid(nowMs);
  const result: Omit<ActionResult, 'replayed'> = {
    actionLogId: id,
    actionType: action.apiName,
    rid: target.rid,
    version: target.version + 1,
    before: pick(target.props, plan.changed),
    after: pick(plan.after.props, plan.changed),
    executedAt: new Date(nowMs).toISOString(),
  };
  const changes: ObjectChangeRef[] = [
    {rid: target.rid, type: target.type, changed: plan.changed},
  ];
  for (const l of [...plan.removeLinks, ...plan.addLinks]) {
    const far = l.src === target.rid ? l.dst : l.src;
    if (changes.some(c => c.rid === far)) continue;
    changes.push({rid: far as Rid, type: far.split('.')[1] ?? '', changed: []});
  }
  const row = outboxRow(ctx.tid, nowMs, 'ActionExecuted', changes, {
    actionLogId: id,
    recommendationId: cmd.recommendationId,
  });
  const outcome = await repos.writer.commitAction({
    update: {
      rid: target.rid,
      expectedVersion: target.version,
      state: plan.after,
      title: titleOf(type, plan.after.props, target.primaryKey),
      hash: await propsHash(plan.after.props),
      index: plan.changed.length ? indexEntries(type, plan.after.props) : null,
      nowMs,
    },
    removeLinks: plan.removeLinks,
    addLinks: plan.addLinks,
    log: {
      id,
      actionType: action.apiName,
      targetRid: target.rid,
      params,
      before: result.before,
      after: result.after,
      actor,
      actorUserId:
        ctx.actor.role === 'admin' ? (ctx.actor.userId ?? null) : null,
      recommendationId: cmd.recommendationId ?? null,
      idempotencyKey: key,
      result,
      executedAt: nowMs,
    },
    outbox: row,
  });
  if (outcome === 'duplicate') {
    const again = await replay();
    if (again) return again;
    throw new AppError('CONFLICT', 'Concurrent execution');
  }
  if (outcome === 'stale') {
    throw new AppError('PRECONDITION_FAILED', 'Version mismatch');
  }
  await deliver(deps, repos, row);
  return {...result, replayed: false};
}
