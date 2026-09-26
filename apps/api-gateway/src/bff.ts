/**
 * @fileoverview Backend-for-frontend orchestrations: calls that combine
 * several services. No business rules beyond sequencing.
 */

import type {TargetProp} from '@ontodecide/decision/contract';
import type {OntologyPack, PublishReport} from '@ontodecide/ontology/contract';
import {AppError, resolveText, type CallCtx} from '@ontodecide/shared-kernel';
import type {Env} from './env';

/** GET /situation/overview: SITUATION.overview + INTEGRATION.dataHealth. */
export async function overviewBff(env: Env, ctx: CallCtx) {
  const [overview, health] = await Promise.all([
    env.SITUATION.overview(ctx),
    env.INTEGRATION.dataHealth(ctx).then(
      d => ({ok: true as const, d}),
      (err: unknown) => ({ok: false as const, code: AppError.from(err).code}),
    ),
  ]);
  return health.ok
    ? {...overview, dataHealth: health.d}
    : {...overview, dataHealth: [], degraded: true};
}

/** Object types touched by breaking changes (`objectTypes.<name>...`). */
export function breakingObjectTypes(report: PublishReport): string[] {
  const types = new Set<string>();
  for (const c of report.diff.changes) {
    if (!c.breaking) continue;
    const [head, name] = c.path.split('.');
    if (head === 'objectTypes' && name) types.add(name);
  }
  return [...types];
}

/**
 * POST /ontology/schemas/:api/publish: publish, then reindex in object-graph
 * and (breaking changes only) pause the affected data sources. Follow-up
 * failures do not undo the publish; they are reported in `warnings`.
 */
export async function publishBff(
  env: Env,
  ctx: CallCtx,
  api: string,
  opts: {confirmVersion?: string},
) {
  const report = await env.ONTOLOGY.publish(ctx, api, opts);
  const breaking = report.diff.breaking;
  const warnings: string[] = [];
  let reindexed = 0;
  let pausedSources = 0;
  try {
    ({reindexed} = await env.OBJECTS.onOntologyPublished(ctx, {
      api: report.apiName,
      version: report.version,
      breaking,
    }));
  } catch (err) {
    warnings.push(`reindex:${AppError.from(err).code}`);
  }
  if (breaking) {
    const types = breakingObjectTypes(report);
    if (types.length > 0) {
      try {
        ({paused: pausedSources} = await env.INTEGRATION.pauseSourcesForTypes(
          ctx,
          types,
        ));
      } catch (err) {
        warnings.push(`pauseSources:${AppError.from(err).code}`);
      }
    }
  }
  return {
    ...report,
    reindexed,
    pausedSources,
    ...(warnings.length ? {warnings} : {}),
  };
}

/**
 * POST /ontology/packs:import: import (publishes the schema), reindex,
 * then install the pack's automations and KPIs in situation-awareness.
 */
export async function importPackBff(
  env: Env,
  ctx: CallCtx,
  input: {packId?: string; pack?: Record<string, unknown>},
) {
  const {report, pack} = await env.ONTOLOGY.importPack(ctx, {
    packId: input.packId,
    pack: input.pack as OntologyPack | undefined,
  });
  const warnings: string[] = [];
  try {
    await env.OBJECTS.onOntologyPublished(ctx, {
      api: report.apiName,
      version: report.version,
      breaking: report.diff.breaking,
    });
  } catch (err) {
    warnings.push(`reindex:${AppError.from(err).code}`);
  }
  const installed = await env.SITUATION.installPackContent(ctx, {
    automations: pack.automations ?? [],
    kpis: pack.kpis ?? [],
  });
  return {
    report,
    pack: {id: pack.id, name: pack.name, version: pack.version},
    installed,
    ...(warnings.length ? {warnings} : {}),
  };
}

/**
 * POST /sources/:id/mapping:suggest: resolves the target type's properties
 * from the active model and asks decision-engine for a mapping draft.
 */
export async function suggestMappingBff(
  env: Env,
  ctx: CallCtx,
  sample: {fields: string[]; rows: unknown[][]; targetType: string},
) {
  const model = await env.ONTOLOGY.getActiveModel(ctx);
  const type = model.objectTypes[sample.targetType];
  if (!type) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Unknown target type: ${sample.targetType}`,
      {errors: [{path: 'targetType', message: 'Unknown object type'}]},
    );
  }
  const targetProps: TargetProp[] = type.properties.map(p => ({
    apiName: p.apiName,
    dataType: p.dataType,
    displayName: resolveText(p.displayName, ctx.locale ?? 'zh-CN', p.apiName),
  }));
  return env.DECISION.suggestMapping(ctx, {...sample, targetProps});
}
