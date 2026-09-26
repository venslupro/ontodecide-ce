/**
 * @fileoverview Publish use case: validate → diff → breaking-change gate →
 * compile → atomic D1 write (PUBLISHED row + draft removal) → cache write.
 * Any failure before the D1 batch leaves the draft unchanged.
 */

import {AppError, parseOrThrow, type CallCtx} from '@ontodecide/shared-kernel';
import {
  publishInputSchema,
  type PublishReport,
  type SchemaDef,
} from '../contract';
import {compileSchema, diffSchemas, indexChanges, parseSemver} from '../domain';
import type {ActiveModelLoader} from './active_model';
import type {OntologyDeps} from './ports';
import {schemaIssues} from './save_draft';
import {compiledOf, iso, otherDefinitions} from './support';

/** Publishes the draft of a schema as a new immutable version. */
export class PublishHandler {
  constructor(
    private readonly deps: OntologyDeps,
    private readonly models: ActiveModelLoader,
  ) {}

  async execute(
    ctx: CallCtx,
    api: string,
    opts?: {confirmVersion?: string},
  ): Promise<PublishReport> {
    const {confirmVersion} = parseOrThrow(publishInputSchema, opts ?? {});
    const {repo, cache, clock, logger} = this.deps;
    const draft = await repo.getDraft(ctx.tenantId, api);
    if (!draft) throw new AppError('NOT_FOUND', `No draft for schema ${api}`);

    const allCurrent = await repo.listCurrent(ctx.tenantId);
    const current = allCurrent.find(r => r.apiName === api) ?? null;
    const issues = schemaIssues(
      draft.definition,
      otherDefinitions(allCurrent, api),
    );
    if (issues.length) {
      throw new AppError('ONTOLOGY_INVALID', issues[0].message, {issues});
    }

    const diff = diffSchemas(current, draft.definition);
    const version = diff.toVersion;
    if (diff.breaking) {
      const majorBumped =
        diff.fromVersion !== null &&
        parseSemver(version).major > parseSemver(diff.fromVersion).major;
      if (!majorBumped || confirmVersion !== version) {
        throw new AppError(
          'ONTOLOGY_BREAKING_CHANGE',
          majorBumped
            ? `Breaking changes: confirm by passing confirmVersion=${version}`
            : `Breaking changes require a major version bump (suggested ${diff.suggestedVersion})`,
          {diff},
        );
      }
    } else if (confirmVersion !== undefined && confirmVersion !== version) {
      throw new AppError(
        'VALIDATION_FAILED',
        `confirmVersion ${confirmVersion} does not match the new version ${version}`,
      );
    }

    const definition: SchemaDef = {...draft.definition, version};
    const compiled = await compileSchema(definition, version);
    const publishedAt = clock.now().getTime();
    await repo.publish(ctx.tenantId, {
      apiName: api,
      version,
      definition,
      compiled,
      publishedBy: ctx.userId,
      publishedAt,
    });

    const changes = indexChanges(
      current ? (await compiledOf(current)).indexPlan : [],
      compiled.indexPlan,
    );
    try {
      const nextCurrent = [
        ...allCurrent.filter(r => r.apiName !== api),
        {
          apiName: api,
          version,
          status: 'PUBLISHED' as const,
          definition,
          compiled,
          publishedBy: ctx.userId,
          publishedAt,
          updatedAt: publishedAt,
        },
      ];
      const model = await this.models.build(ctx.tenantId, nextCurrent);
      await cache.onPublish(ctx.tenantId, compiled, model);
    } catch (e) {
      // The version is committed; a stale cache heals on the next publish
      // (KV) or after the memory TTL.
      logger.error('ontology.cache_write_failed', {
        tenantId: ctx.tenantId,
        api,
        version,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    logger.info('ontology.published', {
      tenantId: ctx.tenantId,
      api,
      version,
      breaking: diff.breaking,
      requestId: ctx.requestId,
    });
    return {
      apiName: api,
      version,
      diff,
      indexChanges: changes,
      publishedAt: iso(publishedAt),
    };
  }
}
