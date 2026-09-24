/**
 * @fileoverview UpsertObjects: consumes one `object-writes` message. Resolves
 * existing objects (one IN query plus alias lookup), merges properties under
 * the source's conflict policy, creates stub objects for link targets that do
 * not exist yet, skips unchanged objects (props hash) and commits objects,
 * index rows, links, aliases, merge suggestions, outbox and inbox in one
 * atomic batch. Then reports the result to data-integration and dispatches
 * the outbox.
 */

import {validateProps} from '@ontodecide/ontology/contract';
import type {
  CompiledModel,
  CompiledObjectType,
} from '@ontodecide/ontology/contract';
import type {
  ObjectWriteMsg,
  UpsertCmd,
  WriteResult,
} from '@ontodecide/integration/contract';
import {AppError, newRid, ulid} from '@ontodecide/shared-kernel';
import type {Rid} from '@ontodecide/shared-kernel';
import type {GraphSyncMsg, ObjectChange} from '../contract';
import {
  bestFuzzyMatch,
  fuzzyBucket,
  isStub,
  linkKey,
  mergeProps,
  objectKey,
  propsHash,
} from '../domain';
import type {StoredLink, StoredObject} from '../domain';
import type {AppDeps, OutboxEvent, WriteOp} from './ports';
import {
  graphSyncEvent,
  indexedValues,
  linkProjected,
  objectChange,
  situationEvent,
} from './support';

/**
 * Synthetic alias source for primary keys of merged-away objects (tenant
 * scoped because og_object_alias is keyed by source and external key).
 */
export function keyAliasSource(tenantId: string, type: string): string {
  return `@key:${tenantId}:${type}`;
}

interface PreparedCmd {
  cmd: UpsertCmd;
  type: CompiledObjectType;
  primaryKey: string;
  props: Record<string, unknown>;
  links: {type: string; toType: string; toKey: string; weight: number | null}[];
}

interface Working {
  obj: StoredObject;
  original: StoredObject | null;
  /** Created in this batch (as an object or a stub). */
  isNew: boolean;
  /** Created as a stub and not filled by a command in this batch. */
  stubOnly: boolean;
  changed: Set<string>;
  /** A command already counted this object as upserted. */
  counted: boolean;
}

/** Outcome of handling a message. */
export interface UpsertOutcome {
  result: WriteResult;
  /** The message had already been processed (inbox hit). */
  duplicate: boolean;
}

/** Use case: upsert a batch of objects from data-integration. */
export class UpsertObjects {
  constructor(private readonly d: AppDeps) {}

  /** Handles one message. Throws on transient failures (retry). */
  async handle(msg: ObjectWriteMsg): Promise<UpsertOutcome> {
    const tenantId = msg.ctx.tenantId;
    const key = `${msg.jobId}:${msg.seq}`;
    const prior = await this.d.meta.getInbox(tenantId, key);
    if (prior) {
      if (prior.reportedAt === null) {
        await this.report(msg, key, prior.result);
      }
      return {result: prior.result, duplicate: true};
    }

    const now = this.d.clock.now();
    const nowMs = now.getTime();
    const model = await this.d.models.get(msg.ctx, {
      expectedVersion: msg.schemaVersion,
    });
    const result: WriteResult = {
      upserted: 0,
      merged: 0,
      skipped: 0,
      rejected: [],
    };
    const prepared = this.prepare(model, msg.cmds, result);

    // Resolve existing objects: one IN query for commands and link targets.
    const keyList = new Map<string, {type: string; primaryKey: string}>();
    for (const p of prepared) {
      keyList.set(objectKey(p.type.apiName, p.primaryKey), {
        type: p.type.apiName,
        primaryKey: p.primaryKey,
      });
      for (const l of p.links) {
        keyList.set(objectKey(l.toType, l.toKey), {
          type: l.toType,
          primaryKey: l.toKey,
        });
      }
    }
    const found = keyList.size
      ? await this.d.reader.getByKeys(tenantId, [...keyList.values()])
      : [];
    const byKey = new Map<string, StoredObject>();
    const byRid = new Map<Rid, StoredObject>();
    for (const o of found) {
      byKey.set(objectKey(o.type, o.primaryKey), o);
      byRid.set(o.rid, o);
    }

    // Alias lookup for keys not found directly.
    const aliasKeys = new Map<
      string,
      {sourceId: string; externalKey: string}
    >();
    const addAlias = (sourceId: string, externalKey: string) =>
      aliasKeys.set(`${sourceId}\u001f${externalKey}`, {sourceId, externalKey});
    for (const p of prepared) {
      if (!byKey.has(objectKey(p.type.apiName, p.primaryKey))) {
        addAlias(keyAliasSource(tenantId, p.type.apiName), p.primaryKey);
        if (p.cmd.externalKey) {
          addAlias(p.cmd.provenance.sourceId, p.cmd.externalKey);
        }
      }
      for (const l of p.links) {
        if (!byKey.has(objectKey(l.toType, l.toKey))) {
          addAlias(keyAliasSource(tenantId, l.toType), l.toKey);
        }
      }
    }
    const aliasRid = new Map<string, Rid>();
    if (aliasKeys.size) {
      const hits = await this.d.reader.findAliases(tenantId, [
        ...aliasKeys.values(),
      ]);
      for (const h of hits) {
        aliasRid.set(`${h.sourceId}\u001f${h.externalKey}`, h.rid);
      }
      const missing = [...new Set(hits.map(h => h.rid))].filter(
        r => !byRid.has(r),
      );
      if (missing.length) {
        for (const o of await this.d.reader.getByRids(tenantId, missing)) {
          byRid.set(o.rid, o);
        }
      }
    }

    const working = new Map<Rid, Working>();
    const keyToRid = new Map<string, Rid>();
    const workingFor = (o: StoredObject): Working => {
      let w = working.get(o.rid);
      if (!w) {
        w = {
          obj: structuredClone(o),
          original: o,
          isNew: false,
          stubOnly: false,
          changed: new Set(),
          counted: false,
        };
        working.set(o.rid, w);
      }
      return w;
    };
    const lookup = (
      type: string,
      primaryKey: string,
      alias?: {sourceId: string; externalKey: string},
    ): Working | undefined => {
      const k = objectKey(type, primaryKey);
      const inBatch = keyToRid.get(k);
      if (inBatch) return working.get(inBatch);
      let o = byKey.get(k);
      if (!o) {
        const viaAlias =
          (alias &&
            aliasRid.get(`${alias.sourceId}\u001f${alias.externalKey}`)) ||
          aliasRid.get(`${keyAliasSource(tenantId, type)}\u001f${primaryKey}`);
        const candidate = viaAlias ? byRid.get(viaAlias) : undefined;
        if (candidate && candidate.type === type) o = candidate;
      }
      if (!o) return undefined;
      const w = workingFor(o);
      keyToRid.set(k, o.rid);
      return w;
    };
    const create = (
      type: CompiledObjectType,
      primaryKey: string,
      stub: boolean,
    ): Working => {
      const rid = newRid(tenantId, type.apiName, nowMs);
      const w: Working = {
        obj: {
          rid,
          tenantId,
          type: type.apiName,
          primaryKey,
          title: primaryKey,
          props: stub ? {[type.primaryKey]: primaryKey} : {},
          propsHash: '',
          provenance: {},
          history: {},
          schemaVersion: model.version,
          version: 1,
          updatedAt: nowMs,
        },
        original: null,
        isNew: true,
        stubOnly: stub,
        changed: new Set(stub ? [type.primaryKey] : []),
        counted: false,
      };
      working.set(rid, w);
      keyToRid.set(objectKey(type.apiName, primaryKey), rid);
      return w;
    };

    const desiredLinks = new Map<string, StoredLink>();
    const newAliases: {sourceId: string; externalKey: string; rid: Rid}[] = [];
    for (const p of prepared) {
      const alias = p.cmd.externalKey
        ? {sourceId: p.cmd.provenance.sourceId, externalKey: p.cmd.externalKey}
        : undefined;
      const existing = lookup(p.type.apiName, p.primaryKey, alias);
      const base = existing?.obj ?? null;
      const merged = mergeProps(base, p.props, p.cmd.provenance, msg.policy);
      if (!existing || existing.stubOnly || isStub(existing.obj)) {
        const missing = p.type.properties
          .filter(
            d =>
              d.required &&
              (merged.state.props[d.apiName] === undefined ||
                merged.state.props[d.apiName] === null),
          )
          .map(d => d.apiName);
        if (missing.length) {
          result.rejected.push({
            row: p.cmd.row,
            code: 'VALIDATION_FAILED',
            detail: `Missing required: ${missing.join(', ')}`,
          });
          continue;
        }
      }
      const w = existing ?? create(p.type, p.primaryKey, false);
      const wasNewish = w.isNew || (w.original !== null && isStub(w.original));
      w.obj.props = merged.state.props;
      w.obj.provenance = merged.state.provenance;
      w.obj.history = merged.state.history;
      const title = merged.state.props[p.type.titleProperty];
      w.obj.title =
        title === undefined || title === null
          ? w.obj.primaryKey
          : String(title);
      w.stubOnly = false;
      merged.changed.forEach(c => w.changed.add(c));
      if (wasNewish && !w.counted) {
        result.upserted++;
        w.counted = true;
      } else if (merged.changed.length) {
        result.merged++;
      } else {
        result.skipped++;
      }
      if (
        alias &&
        !aliasRid.has(`${alias.sourceId}\u001f${alias.externalKey}`)
      ) {
        newAliases.push({...alias, rid: w.obj.rid});
        aliasRid.set(`${alias.sourceId}\u001f${alias.externalKey}`, w.obj.rid);
      }
      for (const l of p.links) {
        const toType = model.objectTypes[l.toType];
        const target =
          lookup(l.toType, l.toKey) ?? create(toType, l.toKey, true);
        const link: StoredLink = {
          type: l.type,
          src: w.obj.rid,
          dst: target.obj.rid,
          weight: l.weight,
        };
        desiredLinks.set(linkKey(link), link);
      }
    }

    // Existing links of persisted sources (skip unchanged links).
    const persistedSrc = [
      ...new Set(
        [...desiredLinks.values()]
          .map(l => l.src)
          .filter(r => !working.get(r)?.isNew),
      ),
    ];
    const existingLinks = new Map<string, StoredLink>();
    if (persistedSrc.length) {
      const linkTypes = [
        ...new Set([...desiredLinks.values()].map(l => l.type)),
      ];
      for (const l of await this.d.reader.links(tenantId, persistedSrc, {
        direction: 'out',
        linkTypes,
      })) {
        existingLinks.set(linkKey(l), l);
      }
    }
    const linkWrites = [...desiredLinks.values()].filter(l => {
      const e = existingLinks.get(linkKey(l));
      return !e || (l.weight !== null && e.weight !== l.weight);
    });

    // Fuzzy entity resolution for objects created from commands.
    const suggestions = await this.fuzzy(tenantId, model, [
      ...working.values(),
    ]);

    // Build the unit of work, grouped by kind (the writer bulks runs).
    const guards: WriteOp[] = [];
    const inserts: WriteOp[] = [];
    const updates: WriteOp[] = [];
    const indexSets: WriteOp[] = [];
    const indexDeletes: WriteOp[] = [];
    const written: Working[] = [];
    for (const w of working.values()) {
      w.obj.propsHash = await propsHash(w.obj.props);
      if (
        w.original &&
        w.original.propsHash === w.obj.propsHash &&
        w.original.title === w.obj.title
      ) {
        continue;
      }
      const type = model.objectTypes[w.obj.type];
      if (w.isNew) {
        inserts.push({kind: 'insertObject', obj: w.obj});
      } else {
        guards.push({
          kind: 'guardVersion',
          tenantId,
          rid: w.obj.rid,
          version: w.original!.version,
        });
        w.obj.version = w.original!.version + 1;
        w.obj.updatedAt = nowMs;
        w.obj.schemaVersion = model.version;
        updates.push({kind: 'updateObject', obj: w.obj});
      }
      const indexProps = w.isNew
        ? type.indexedProps
        : type.indexedProps.filter(p => w.changed.has(p));
      for (const prop of indexProps) {
        const value = w.obj.props[prop];
        if (value === undefined || value === null) {
          if (!w.isNew) {
            indexDeletes.push({
              kind: 'setIndex',
              tenantId,
              type: w.obj.type,
              rid: w.obj.rid,
              prop,
              value: null,
            });
          }
          continue;
        }
        indexSets.push({
          kind: 'setIndex',
          tenantId,
          type: w.obj.type,
          rid: w.obj.rid,
          prop,
          value,
        });
      }
      written.push(w);
    }
    const ops: WriteOp[] = [
      ...guards,
      ...inserts,
      ...updates,
      ...indexDeletes,
      ...indexSets,
    ];
    for (const link of linkWrites) {
      ops.push({kind: 'upsertLink', tenantId, link});
    }
    for (const a of newAliases) ops.push({kind: 'alias', tenantId, ...a});
    for (const s of suggestions) {
      ops.push({
        kind: 'mergeSuggestion',
        tenantId,
        id: ulid(nowMs),
        ridA: s.ridA,
        ridB: s.ridB,
        score: s.score,
        createdAt: nowMs,
      });
    }

    const events: OutboxEvent[] = [];
    const changes: ObjectChange[] = written.map(w =>
      objectChange(w.obj, w.changed),
    );
    const sync: Omit<GraphSyncMsg, 'tenantId'> = {
      upserts: written
        .filter(w => model.objectTypes[w.obj.type]?.graphProjected)
        .map(w => ({
          rid: w.obj.rid,
          type: w.obj.type,
          title: w.obj.title,
          idx: indexedValues(model.objectTypes[w.obj.type], w.obj.props),
        })),
      links: linkWrites
        .filter(l => linkProjected(model, l.type))
        .map(l => ({
          type: l.type,
          src: l.src,
          dst: l.dst,
          weight: l.weight ?? null,
          op: 'merge' as const,
        })),
    };
    const eventCount =
      (changes.length ? 1 : 0) +
      (sync.upserts.length || sync.links.length ? 1 : 0) +
      (msg.last ? 1 : 0);
    const rowsWritten =
      ops.filter(o => o.kind !== 'guardVersion').length + eventCount + 1;
    if (changes.length) {
      events.push(
        situationEvent(tenantId, now, {
          kind: 'ObjectsUpserted',
          correlationId: msg.ctx.correlationId,
          changes,
          usage: [{resource: 'd1.rowsWritten', n: rowsWritten}],
        }),
      );
    }
    if (sync.upserts.length || sync.links.length) {
      events.push(graphSyncEvent(tenantId, now, sync));
    }
    if (msg.last) {
      events.push(
        situationEvent(tenantId, now, {
          kind: 'JobFinished',
          correlationId: msg.ctx.correlationId,
          changes: [],
          job: {jobId: msg.jobId},
        }),
      );
    }
    for (const event of events) ops.push({kind: 'outbox', event});
    ops.push({kind: 'inbox', tenantId, key, result, at: nowMs});

    try {
      await this.d.writer.commit(ops);
    } catch (e) {
      const err = AppError.from(e);
      if (err.code === 'CONFLICT' && err.extras.duplicate === 'inbox') {
        return {result, duplicate: true};
      }
      throw e;
    }

    await this.report(msg, key, result);
    try {
      await this.d.outbox.dispatch(events, this.d.clock.now());
    } catch (e) {
      this.d.logger.warn('outbox dispatch failed; cron will retry', {
        useCase: 'UpsertObjects',
        error: String(e),
      });
    }
    return {result, duplicate: false};
  }

  private async report(
    msg: ObjectWriteMsg,
    key: string,
    result: WriteResult,
  ): Promise<void> {
    await this.d.integration.reportWriteResult(
      msg.ctx,
      msg.jobId,
      msg.seq,
      msg.last,
      result,
    );
    await this.d.meta.markReported(
      msg.ctx.tenantId,
      key,
      this.d.clock.now().getTime(),
    );
  }

  private prepare(
    model: CompiledModel,
    cmds: readonly UpsertCmd[],
    result: WriteResult,
  ): PreparedCmd[] {
    const out: PreparedCmd[] = [];
    for (const cmd of cmds) {
      const type = model.objectTypes[cmd.type];
      if (!type) {
        result.rejected.push({
          row: cmd.row,
          code: 'UNKNOWN_TYPE',
          detail: `Unknown object type ${cmd.type}`,
        });
        continue;
      }
      const primaryKey = String(cmd.primaryKey ?? '').trim();
      if (!primaryKey) {
        result.rejected.push({
          row: cmd.row,
          code: 'VALIDATION_FAILED',
          detail: 'Primary key is empty',
        });
        continue;
      }
      const v = validateProps(
        type,
        {...cmd.props, [type.primaryKey]: primaryKey},
        {partial: true},
      );
      if (v.errors.length) {
        result.rejected.push({
          row: cmd.row,
          code: 'VALIDATION_FAILED',
          detail: v.errors.map(e => `${e.prop}: ${e.detail}`).join('; '),
        });
        continue;
      }
      const links: PreparedCmd['links'] = [];
      let linkError: string | null = null;
      for (const l of cmd.links ?? []) {
        const lt = model.linkTypes[l.type];
        const toKey = String(l.toKey ?? '').trim();
        if (!toKey) continue;
        if (
          !lt ||
          lt.from !== type.apiName ||
          lt.to !== l.toType ||
          !model.objectTypes[l.toType]
        ) {
          linkError = `Invalid link ${l.type} → ${l.toType}`;
          break;
        }
        const weight =
          typeof l.weight === 'number' && Number.isFinite(l.weight)
            ? l.weight
            : null;
        links.push({type: l.type, toType: l.toType, toKey, weight});
      }
      if (linkError) {
        result.rejected.push({
          row: cmd.row,
          code: 'LINK_INVALID',
          detail: linkError,
        });
        continue;
      }
      out.push({cmd, type, primaryKey, props: v.props, links});
    }
    return out;
  }

  private async fuzzy(
    tenantId: string,
    model: CompiledModel,
    items: readonly Working[],
  ): Promise<{ridA: Rid; ridB: Rid; score: number}[]> {
    const groups = new Map<string, Working[]>();
    for (const w of items) {
      if (!w.isNew || w.stubOnly) continue;
      const type = model.objectTypes[w.obj.type];
      if (!type || type.titleProperty === type.primaryKey) continue;
      const bucket = fuzzyBucket(w.obj.title);
      if (!bucket) continue;
      const k = `${w.obj.type}\u001f${bucket}`;
      groups.set(k, [...(groups.get(k) ?? []), w]);
    }
    const out: {ridA: Rid; ridB: Rid; score: number}[] = [];
    for (const [k, list] of groups) {
      const [type, bucket] = k.split('\u001f');
      const candidates = await this.d.reader.fuzzyCandidates(
        tenantId,
        type,
        bucket,
        201,
      );
      for (const w of list) {
        const m = bestFuzzyMatch(w.obj.title, candidates, {exclude: w.obj.rid});
        if (m) out.push({ridA: m.rid, ridB: w.obj.rid, score: m.score});
      }
    }
    return out;
  }
}
