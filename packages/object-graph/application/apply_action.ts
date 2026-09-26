/**
 * @fileoverview ApplyAction: executes an ontology action on one object.
 * Checks role, visibility, approval voucher, If-Match and preconditions,
 * applies the effects, and commits the object, index rows, link changes,
 * audit log and outbox in one batch. Writeback failures mark the log
 * WRITEBACK_PENDING (retried by cron) and never roll back the action.
 */

import type {ActionTypeDef, CompiledModel} from '@ontodecide/ontology/contract';
import {AppError, isRid, parseRid, ulid} from '@ontodecide/shared-kernel';
import type {CallCtx, Provenance, Rid} from '@ontodecide/shared-kernel';
import {verifyVoucher} from '../contract';
import type {ActionResult, ApplyActionCmd, WritebackStatus} from '../contract';
import {
  applyEffects,
  evaluatePreconditions,
  filterByMarkings,
  normalizeParams,
  objectRefParams,
  overwriteProps,
  planLinkChanges,
  propsHash,
} from '../domain';
import type {StoredObject} from '../domain';
import type {ActionLogRecord, AppDeps, OutboxEvent, WriteOp} from './ports';
import {
  graphSyncEvent,
  indexedValues,
  linkProjected,
  objectChange,
  requireRole,
  ridInTenant,
  situationEvent,
} from './support';

/** Body POSTed to a writeback webhook. */
export function writebackBody(log: ActionLogRecord): Record<string, unknown> {
  return {
    actionLogId: log.id,
    tenantId: log.tenantId,
    actionType: log.actionType,
    target: log.targetRid,
    params: log.params,
    before: log.before,
    after: log.after,
    actor: log.actor,
    recommendationId: log.recommendationId ?? null,
    executedAt: log.executedAt,
  };
}

/** Use case: apply an action. */
export class ApplyAction {
  constructor(private readonly d: AppDeps) {}

  async handle(ctx: CallCtx, cmd: ApplyActionCmd): Promise<ActionResult> {
    requireRole(ctx, 'Operator');
    const model = await this.d.models.get(ctx);
    const action = model.actionTypes[cmd.actionType];
    if (!action) {
      throw new AppError('NOT_FOUND', `Unknown action type ${cmd.actionType}`);
    }
    const target = ridInTenant(ctx, cmd.target)
      ? await this.d.reader.getByRid(ctx.tenantId, cmd.target)
      : null;
    if (!target) throw new AppError('OBJECT_NOT_FOUND');
    if (target.type !== action.targetType) {
      throw new AppError(
        'VALIDATION_FAILED',
        `${cmd.actionType} applies to ${action.targetType}, not ${target.type}`,
      );
    }

    const now = this.d.clock.now();
    let recommendationId = cmd.recommendationId;
    if (action.requiresApproval) {
      recommendationId = await this.checkApproval(ctx, cmd, now);
    }
    if (recommendationId) {
      const prior = await this.d.actionLogs.findByRecommendation(
        ctx.tenantId,
        recommendationId,
        cmd.actionType,
        cmd.target,
      );
      if (prior)
        return this.toResult(ctx, model, target.type, prior, target.version);
    }
    if (cmd.ifMatch !== undefined && cmd.ifMatch !== target.version) {
      throw new AppError('VERSION_CONFLICT', 'Object version changed', {
        currentVersion: target.version,
      });
    }

    const norm = normalizeParams(action, cmd.params ?? {});
    if (norm.errors.length) {
      throw new AppError('VALIDATION_FAILED', norm.errors[0].detail, {
        errors: norm.errors.map(e => ({
          path: `params.${e.param}`,
          message: e.detail,
        })),
      });
    }
    const params = await this.resolveRefs(ctx, action, norm.params);
    const unmet = evaluatePreconditions(
      action,
      target.props,
      params,
      ctx.locale ?? 'en-US',
    );
    if (unmet.length) {
      throw new AppError('PRECONDITION_FAILED', unmet[0], {unmet});
    }

    const effects = applyEffects(action, target.props, params);
    const actionLogId = ulid(now.getTime());
    const provenance: Provenance = {
      sourceId: `action:${action.apiName}`,
      datasetTxn: actionLogId,
      recordRef: target.rid,
      ingestedAt: now.toISOString(),
      confidence: 1,
    };
    const merged = overwriteProps(target, effects.updates, provenance);
    const type = model.objectTypes[target.type];
    const titleValue = merged.state.props[type.titleProperty];
    const after: StoredObject = {
      ...target,
      props: merged.state.props,
      provenance: merged.state.provenance,
      history: merged.state.history,
      title:
        titleValue === undefined || titleValue === null
          ? target.primaryKey
          : String(titleValue),
      propsHash: await propsHash(merged.state.props),
      version: target.version + 1,
      schemaVersion: model.version,
      updatedAt: now.getTime(),
    };

    const linkTypes = [...new Set(effects.linkEffects.map(e => e.link))];
    const existing = linkTypes.length
      ? await this.d.reader.links(ctx.tenantId, [target.rid], {
          direction: 'both',
          linkTypes,
        })
      : [];
    const linkChanges = planLinkChanges(
      target.rid,
      effects.linkEffects,
      existing,
    );

    const webhook =
      action.writeback?.kind === 'webhook' ? action.writeback : null;
    const log: ActionLogRecord = {
      id: actionLogId,
      tenantId: ctx.tenantId,
      actionType: action.apiName,
      targetRid: target.rid,
      params,
      before: target.props,
      after: after.props,
      actor: ctx.userId,
      ...(recommendationId ? {recommendationId} : {}),
      writebackStatus: 'NONE',
      writebackAttempts: 0,
      executedAt: now.toISOString(),
    };

    const ops: WriteOp[] = [
      {
        kind: 'guardVersion',
        tenantId: ctx.tenantId,
        rid: target.rid,
        version: target.version,
      },
      {kind: 'updateObject', obj: after},
    ];
    for (const prop of type.indexedProps.filter(p =>
      merged.changed.includes(p),
    )) {
      ops.push({
        kind: 'setIndex',
        tenantId: ctx.tenantId,
        type: target.type,
        rid: target.rid,
        prop,
        value: after.props[prop] ?? null,
      });
    }
    for (const link of linkChanges.remove) {
      ops.push({kind: 'deleteLink', tenantId: ctx.tenantId, link});
    }
    for (const link of linkChanges.add) {
      ops.push({kind: 'upsertLink', tenantId: ctx.tenantId, link});
    }
    ops.push({kind: 'actionLog', entry: log});

    const events: OutboxEvent[] = [];
    const idxChanged = type.indexedProps.some(p => merged.changed.includes(p));
    const syncLinks = [
      ...linkChanges.remove.map(l => ({...l, op: 'delete' as const})),
      ...linkChanges.add.map(l => ({...l, op: 'merge' as const})),
    ]
      .filter(l => linkProjected(model, l.type))
      .map(l => ({
        type: l.type,
        src: l.src,
        dst: l.dst,
        weight: l.weight ?? null,
        op: l.op,
      }));
    const syncUpserts =
      type.graphProjected && (idxChanged || after.title !== target.title)
        ? [
            {
              rid: after.rid,
              type: after.type,
              title: after.title,
              idx: indexedValues(type, after.props),
            },
          ]
        : [];
    const linksChanged = linkChanges.add.length + linkChanges.remove.length > 0;
    const changedNames = [
      ...merged.changed,
      ...(linksChanged ? linkTypes : []),
    ];
    const hasSync = syncLinks.length > 0 || syncUpserts.length > 0;
    const rowsWritten =
      ops.filter(o => o.kind !== 'guardVersion').length + (hasSync ? 2 : 1);
    events.push(
      situationEvent(ctx.tenantId, now, {
        kind: 'ActionExecuted',
        correlationId: ctx.correlationId,
        changes: [objectChange(after, changedNames)],
        action: {
          actionLogId,
          actionType: action.apiName,
          ...(recommendationId ? {recommendationId} : {}),
        },
        usage: [{resource: 'd1.rowsWritten', n: rowsWritten}],
      }),
    );
    if (hasSync) {
      events.push(
        graphSyncEvent(ctx.tenantId, now, {
          upserts: syncUpserts,
          links: syncLinks,
        }),
      );
    }
    for (const event of events) ops.push({kind: 'outbox', event});

    await this.d.writer.commit(ops);
    try {
      await this.d.outbox.dispatch(events, this.d.clock.now());
    } catch (e) {
      this.d.logger.warn('outbox dispatch failed; cron will retry', {
        useCase: 'ApplyAction',
        error: String(e),
      });
    }

    if (webhook) {
      let status: WritebackStatus = 'SENT';
      try {
        await this.d.writeback.send({
          url: webhook.url,
          body: writebackBody(log),
          idempotencyKey: log.id,
        });
      } catch (e) {
        status = 'WRITEBACK_PENDING';
        this.d.logger.warn('writeback failed', {
          useCase: 'ApplyAction',
          actionLogId: log.id,
          error: String(e),
        });
      }
      await this.d.actionLogs.setWriteback(ctx.tenantId, log.id, status, 1);
      log.writebackStatus = status;
      log.writebackAttempts = 1;
    }
    return this.toResult(ctx, model, target.type, log, after.version);
  }

  private async checkApproval(
    ctx: CallCtx,
    cmd: ApplyActionCmd,
    now: Date,
  ): Promise<string> {
    const v = cmd.approval;
    const required = new AppError(
      'APPROVAL_REQUIRED',
      `${cmd.actionType} requires an approved recommendation`,
    );
    if (!v || !this.d.approvalSecret) throw required;
    const matches =
      v.tenantId === ctx.tenantId &&
      v.actionType === cmd.actionType &&
      v.target === cmd.target &&
      (!cmd.recommendationId || cmd.recommendationId === v.recommendationId);
    if (!matches) throw required;
    let valid = false;
    try {
      valid = await verifyVoucher(this.d.approvalSecret, v, now);
    } catch {
      valid = false;
    }
    if (!valid) throw required;
    return v.recommendationId;
  }

  /** Resolves objectRef params given as a RID or a primary key to RIDs. */
  private async resolveRefs(
    ctx: CallCtx,
    action: ActionTypeDef,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const out = {...params};
    for (const ref of objectRefParams(action)) {
      const raw = out[ref.param];
      if (raw === undefined || raw === null) continue;
      const value = String(raw);
      let obj: StoredObject | null = null;
      if (isRid(value)) {
        const parts = parseRid(value)!;
        if (
          parts.tenantId === ctx.tenantId &&
          parts.objectType === ref.objectType
        ) {
          obj = await this.d.reader.getByRid(ctx.tenantId, value as Rid);
        }
      } else {
        [obj] = await this.d.reader.getByKeys(ctx.tenantId, [
          {type: ref.objectType, primaryKey: value},
        ]);
        obj ??= null;
      }
      if (!obj || obj.type !== ref.objectType) {
        throw new AppError(
          'VALIDATION_FAILED',
          `Parameter ${ref.param}: ${ref.objectType} not found`,
          {
            errors: [
              {path: `params.${ref.param}`, message: 'Object not found'},
            ],
          },
        );
      }
      out[ref.param] = obj.rid;
    }
    return out;
  }

  private toResult(
    ctx: CallCtx,
    model: CompiledModel,
    type: string,
    log: ActionLogRecord,
    version: number,
  ): ActionResult {
    const t = model.objectTypes[type];
    return {
      actionLogId: log.id,
      actionType: log.actionType,
      rid: log.targetRid,
      version,
      before: filterByMarkings(ctx, t, log.before).props,
      after: filterByMarkings(ctx, t, log.after).props,
      writebackStatus: log.writebackStatus,
      executedAt: log.executedAt,
    };
  }
}
