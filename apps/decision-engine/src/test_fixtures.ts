/**
 * @fileoverview Test fakes for decision-engine: an in-memory object graph,
 * a situation stub, the compiled test ontology and an env builder.
 */

import {
  AppError,
  FixedClock,
  matchFilter,
  silentLogger,
  type CallCtx,
  type PageRequest,
  type Rid,
} from '@ontodecide/shared-kernel';
import type {
  ActionResult,
  ApplyActionCmd,
  GraphEdge,
  GraphNode,
  GraphSlice,
  ImpactQuery,
  LinksQuery,
  ObjectDto,
  ObjectGraphRpc,
  ObjectPage,
  ObjectQuery,
} from '@ontodecide/object-graph/contract';
import type {OntologyRpc} from '@ontodecide/ontology/contract';
import type {
  RecommendationSummary,
  SituationRpc,
} from '@ontodecide/situation/contract';
import {
  createTestD1,
  FakeWorkersAi,
  rpcBinding,
  TEST_TID,
} from '@ontodecide/testing';
import {
  testEdges,
  testObjects,
  testSchema,
  type TestObject,
} from '../../../packages/decision/domain/testing/supply_chain_fixture';
import type {Env} from './env';
import {createService, type Overrides} from './service';

export * from '../../../packages/decision/domain/testing/supply_chain_fixture';

type GraphApi = Pick<
  ObjectGraphRpc,
  'getObject' | 'listObjects' | 'getLinks' | 'impactSubgraph' | 'applyAction'
>;

/** In-memory object graph (one graph per workspace). */
export class FakeObjectGraph implements GraphApi {
  readonly objects = new Map<string, Map<Rid, TestObject>>();
  readonly edges = new Map<string, GraphEdge[]>();
  readonly applied: {ctx: CallCtx; cmd: ApplyActionCmd}[] = [];
  /** Number of upcoming applyAction calls that fail. */
  failNext = 0;
  private readonly results = new Map<string, ActionResult>();

  constructor(tids: string[] = [TEST_TID]) {
    for (const tid of tids) {
      this.objects.set(tid, new Map(testObjects().map(o => [o.rid, o])));
      this.edges.set(tid, testEdges());
    }
  }

  /** Sets a property of an object in a workspace. */
  setProp(rid: Rid, prop: string, value: unknown, tid = TEST_TID): void {
    this.objects.get(tid)!.get(rid)!.props[prop] = value;
  }

  private all(tid: string): Map<Rid, TestObject> {
    return this.objects.get(tid) ?? new Map();
  }

  private dto(o: TestObject): ObjectDto {
    return {
      rid: o.rid,
      type: o.type,
      primaryKey: String(Object.values(o.props)[0]),
      title: o.title,
      props: {...o.props},
      provenance: {},
      version: 1,
      updatedAt: '2026-09-24T00:00:00.000Z',
    };
  }

  private node(o: TestObject, hop: number): GraphNode {
    return {rid: o.rid, type: o.type, title: o.title, props: {...o.props}, hop};
  }

  async getObject(ctx: CallCtx, rid: Rid): Promise<ObjectDto | null> {
    const o = this.all(ctx.tid).get(rid);
    return o ? this.dto(o) : null;
  }

  async listObjects(
    ctx: CallCtx,
    q: ObjectQuery,
    page: PageRequest,
  ): Promise<ObjectPage> {
    const items = [...this.all(ctx.tid).values()]
      .filter(o => !q.type || o.type === q.type)
      .filter(o => matchFilter(q.filter, o.props))
      .map(o => this.dto(o));
    return {items: items.slice(0, page.limit ?? 50), nextCursor: null};
  }

  async getLinks(ctx: CallCtx, rid: Rid, q: LinksQuery): Promise<GraphSlice> {
    const objs = this.all(ctx.tid);
    const root = objs.get(rid);
    if (!root) return {nodes: [], edges: [], truncated: false};
    const dir = q.direction ?? 'both';
    const edges = (this.edges.get(ctx.tid) ?? []).filter(
      e =>
        (!q.linkTypes?.length || q.linkTypes.includes(e.type)) &&
        ((dir !== 'in' && e.src === rid) || (dir !== 'out' && e.dst === rid)),
    );
    const nodes = [this.node(root, 0)];
    for (const e of edges) {
      const other = objs.get(e.src === rid ? e.dst : e.src);
      if (other && !nodes.some(n => n.rid === other.rid)) {
        nodes.push(this.node(other, 1));
      }
    }
    return {nodes, edges, truncated: false};
  }

  async impactSubgraph(ctx: CallCtx, q: ImpactQuery): Promise<GraphSlice> {
    const objs = this.all(ctx.tid);
    const hop = new Map<Rid, number>();
    const queue: Rid[] = [];
    for (const r of q.rids) {
      if (objs.has(r) && !hop.has(r)) {
        hop.set(r, 0);
        queue.push(r);
      }
    }
    const all = this.edges.get(ctx.tid) ?? [];
    const used: GraphEdge[] = [];
    for (let i = 0; i < queue.length; i++) {
      const src = queue[i];
      const d = hop.get(src)!;
      if (d >= q.depth) continue;
      for (const e of all) {
        if (e.src !== src || !q.linkTypes.includes(e.type)) continue;
        used.push(e);
        if (!hop.has(e.dst)) {
          hop.set(e.dst, d + 1);
          queue.push(e.dst);
        }
      }
    }
    const nodes = queue
      .slice(0, q.limit)
      .map(r => this.node(objs.get(r)!, hop.get(r)!));
    return {nodes, edges: used, truncated: queue.length > q.limit};
  }

  async applyAction(ctx: CallCtx, cmd: ApplyActionCmd): Promise<ActionResult> {
    this.applied.push({ctx, cmd});
    const prior = this.results.get(cmd.idempotencyKey);
    if (prior) return {...prior, replayed: true};
    if (this.failNext > 0) {
      this.failNext--;
      throw new AppError('VALIDATION_FAILED', 'precondition failed', {
        status: 422,
      });
    }
    const res: ActionResult = {
      actionLogId: `log-${this.results.size + 1}`,
      actionType: cmd.actionType,
      rid: cmd.target,
      version: 2,
      before: {},
      after: {},
      executedAt: '2026-09-24T00:00:00.000Z',
      replayed: false,
    };
    this.results.set(cmd.idempotencyKey, res);
    return res;
  }
}

/** Situation stub recording pushed summaries. */
export class FakeSituation implements Pick<SituationRpc, 'pushRecommendation'> {
  readonly pushed: RecommendationSummary[] = [];
  fail = false;

  async pushRecommendation(
    _ctx: CallCtx,
    rec: RecommendationSummary,
  ): Promise<void> {
    if (this.fail) throw new Error('situation down');
    this.pushed.push(rec);
  }
}

/** A wired test service. */
export interface Harness {
  env: Env;
  db: D1Database;
  objects: FakeObjectGraph;
  situation: FakeSituation;
  ai: FakeWorkersAi;
  clock: FixedClock;
  svc: ReturnType<typeof createService>;
}

/** Builds env + service with fakes. `vars` override Env vars. */
export function harness(
  opts: {
    vars?: Partial<Env>;
    withAi?: boolean;
    tids?: string[];
    overrides?: Overrides;
  } = {},
): Harness {
  const db = createTestD1('decision-engine');
  const objects = new FakeObjectGraph(opts.tids);
  const situation = new FakeSituation();
  const ai = new FakeWorkersAi();
  const clock = new FixedClock('2026-09-24T08:00:00Z');
  const ontology: Pick<OntologyRpc, 'getCompiledSchema'> = {
    getCompiledSchema: async () => testSchema(),
  };
  const env: Env = {
    DECISION_DB: db,
    OBJECTS: rpcBinding(objects as unknown as ObjectGraphRpc),
    SITUATION: rpcBinding(situation as unknown as SituationRpc),
    ONTOLOGY: rpcBinding(ontology as OntologyRpc),
    ...(opts.withAi === false ? {} : {AI: ai.asAi()}),
    ENVIRONMENT: 'test',
    ...opts.vars,
  };
  const svc = createService(env, {
    clock,
    logger: silentLogger,
    ...opts.overrides,
  });
  return {env, db, objects, situation, ai, clock, svc};
}
