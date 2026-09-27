/**
 * @fileoverview Test fixtures: an in-memory object graph implementing the
 * parts of ObjectGraphRpc data-integration uses, a fake ontology, and a
 * helper wiring the use-case dependencies over a test D1.
 */

import {
  CE_LIMITS,
  FixedClock,
  silentLogger,
  ulid,
} from '@ontodecide/shared-kernel';
import type {CallCtx} from '@ontodecide/shared-kernel';
import type {CompiledSchema, OntologyRpc} from '@ontodecide/ontology/contract';
import type {
  GraphStats,
  ObjectGraphRpc,
  UpsertCmd,
  WriteResult,
} from '@ontodecide/object-graph/contract';
import type {AiPort, IntegrationDeps} from '../application';
import {supplyChainSchema} from '../domain/schema_fixture';
import {D1JobRepository, D1UsageRepository} from '../infrastructure';

interface StoredObject {
  type: string;
  primaryKey: string;
  props: Record<string, unknown>;
}

/** In-memory object graph (per workspace). */
export class FakeObjectGraph implements Pick<
  ObjectGraphRpc,
  'stats' | 'upsertBatch'
> {
  readonly objects = new Map<string, Map<string, StoredObject>>();
  readonly links = new Map<string, Map<string, number | null>>();
  readonly calls: {jobId: string; seq: number; cmds: UpsertCmd[]}[] = [];
  /** Throws on the next upsertBatch when set. */
  failNext: Error | null = null;

  constructor(
    private readonly types = new Set(['Supplier', 'Material', 'Product']),
    readonly maxObjects: number = CE_LIMITS.objects,
    readonly maxLinks: number = CE_LIMITS.links,
  ) {}

  private objs(tid: string) {
    let m = this.objects.get(tid);
    if (!m) this.objects.set(tid, (m = new Map()));
    return m;
  }

  private lnks(tid: string) {
    let m = this.links.get(tid);
    if (!m) this.links.set(tid, (m = new Map()));
    return m;
  }

  async stats(ctx: CallCtx): Promise<GraphStats> {
    const byType: Record<string, number> = {};
    for (const o of this.objs(ctx.tid).values()) {
      byType[o.type] = (byType[o.type] ?? 0) + 1;
    }
    return {
      objects: this.objs(ctx.tid).size,
      links: this.lnks(ctx.tid).size,
      byType,
    };
  }

  async upsertBatch(
    ctx: CallCtx,
    cmd: {jobId: string; seq: number; cmds: UpsertCmd[]},
  ): Promise<WriteResult> {
    this.calls.push(structuredClone(cmd));
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    const objs = this.objs(ctx.tid);
    const lnks = this.lnks(ctx.tid);
    const out: WriteResult = {
      upserted: 0,
      skipped: 0,
      linksWritten: 0,
      rejected: [],
    };
    for (const c of cmd.cmds) {
      if (!this.types.has(c.type)) {
        out.rejected.push({row: c.row, code: 'UNKNOWN_TYPE'});
        continue;
      }
      const key = `${c.type}:${c.primaryKey}`;
      const prev = objs.get(key);
      if (!prev && objs.size >= this.maxObjects) {
        out.rejected.push({row: c.row, code: 'OBJECT_LIMIT'});
        continue;
      }
      const props = {...prev?.props, ...c.props};
      if (prev && JSON.stringify(prev.props) === JSON.stringify(props)) {
        out.skipped++;
      } else {
        objs.set(key, {type: c.type, primaryKey: c.primaryKey, props});
        out.upserted++;
      }
      for (const l of c.links ?? []) {
        const dst = `${l.toType}:${l.toKey}`;
        if (!objs.has(dst)) {
          out.rejected.push({row: c.row, code: 'REF_MISSING', detail: dst});
          continue;
        }
        const lk = `${key}|${l.type}|${dst}`;
        if (!lnks.has(lk) && lnks.size >= this.maxLinks) {
          out.rejected.push({row: c.row, code: 'LINK_LIMIT'});
          continue;
        }
        lnks.set(lk, l.weight ?? null);
        out.linksWritten++;
      }
    }
    return out;
  }
}

/** Fake ontology returning a fixed compiled schema. */
export function fakeOntology(
  schema: CompiledSchema = supplyChainSchema(),
): Pick<OntologyRpc, 'getCompiledSchema'> {
  return {getCompiledSchema: async () => structuredClone(schema)};
}

/** Test dependencies over a migrated test D1. */
export function testDeps(
  db: D1Database,
  opts: {
    objects?: FakeObjectGraph;
    ai?: AiPort | null;
    clock?: FixedClock;
    config?: Partial<IntegrationDeps['config']>;
  } = {},
): IntegrationDeps & {clock: FixedClock; objects: FakeObjectGraph} {
  const clock = opts.clock ?? new FixedClock('2026-09-24T08:00:00Z');
  const objects = opts.objects ?? new FakeObjectGraph();
  return {
    jobs: ctx => new D1JobRepository(db, ctx.tid),
    usage: new D1UsageRepository(db),
    ontology: fakeOntology(),
    objects,
    ai: opts.ai ?? null,
    clock,
    logger: silentLogger,
    config: {
      importRowsDaily: 2000,
      seedRowsDaily: 20_000,
      mappingAiDaily: 2,
      neuronsDailyBudget: 1500,
      draftNeurons: 19,
      reserveFactor: 1.3,
      maxObjects: CE_LIMITS.objects,
      maxLinks: CE_LIMITS.links,
      ...opts.config,
    },
    newId: nowMs => ulid(nowMs),
  };
}
