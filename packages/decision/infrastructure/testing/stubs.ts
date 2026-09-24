/**
 * @fileoverview Test doubles for the services decision-engine binds:
 * an in-memory supply-chain object graph (OBJECTS), a recording SITUATION
 * and an ONTOLOGY serving the compiled supply-chain pack. Test-only.
 */

import {
  AppError,
  matchFilter,
  parseRid,
  type CallCtx,
  type Clock,
  type ObjectSetDef,
  type PageRequest,
  type Rid,
  type UsageResource,
  type UsageStatus,
} from '@ontodecide/shared-kernel';
import {
  verifyVoucher,
  type ActionResult,
  type ApplyActionCmd,
  type GraphSlice,
  type ImpactQuery,
  type ObjectDto,
  type ObjectGraphRpc,
  type ObjectPage,
} from '@ontodecide/object-graph/contract';
import type {CompiledModel, OntologyRpc} from '@ontodecide/ontology/contract';
import type {
  RecommendationSummary,
  SituationRpc,
} from '@ontodecide/situation/contract';
import {
  subgraph,
  supplyChainGraph,
  supplyChainModel,
} from '../../domain/testing/supply_chain_fixture';

type GraphSubset = Pick<
  ObjectGraphRpc,
  'impactSubgraph' | 'getObjects' | 'evaluateObjectSet' | 'applyAction'
>;

/** In-memory object graph implementing the calls decision makes. */
export class InMemoryObjectGraph implements GraphSubset {
  graph: GraphSlice;
  readonly applied: {ctx: CallCtx; cmd: ApplyActionCmd}[] = [];
  readonly impactQueries: ImpactQuery[] = [];
  /** Error code thrown by the next applyAction (once). */
  failNext?: string;
  /** Extra dummy nodes returned by impactSubgraph (GRAPH_TOO_LARGE tests). */
  inflate = 0;
  degraded = false;
  private seq = 0;

  constructor(
    private readonly secret: string,
    private readonly clock: Clock,
    tenantId = 't1',
  ) {
    this.graph = supplyChainGraph(tenantId);
  }

  private checkTenant(ctx: CallCtx, rid: string): void {
    if (parseRid(rid)?.tenantId !== ctx.tenantId) {
      throw new AppError('FORBIDDEN', `Cross-tenant access: ${rid}`);
    }
  }

  private dto(ctx: CallCtx, rid: Rid): ObjectDto | null {
    const n = this.graph.nodes.find(x => x.rid === rid);
    if (!n) return null;
    const canSeePii =
      ctx.markings.includes('*') || ctx.markings.includes('PII');
    const props = {...n.props};
    const hidden: string[] = [];
    if (!canSeePii && 'contactEmail' in props) {
      delete props.contactEmail;
      hidden.push('contactEmail');
    }
    return {
      rid: n.rid,
      type: n.type,
      primaryKey: rid.split('.')[3],
      title: n.title,
      props,
      provenance: Object.fromEntries(
        Object.keys(props).map(k => [
          k,
          {
            sourceId: `src-${n.type.toLowerCase()}`,
            datasetTxn: 'txn-1',
            recordRef: `${n.type}:${rid.split('.')[3]}`,
            ingestedAt: '2026-09-23T00:00:00.000Z',
            confidence: 1,
          },
        ]),
      ),
      version: 1,
      schemaVersion: '1.0.0',
      updatedAt: '2026-09-23T00:00:00.000Z',
      ...(hidden.length ? {hiddenProps: hidden} : {}),
    };
  }

  async impactSubgraph(
    ctx: CallCtx,
    q: ImpactQuery,
  ): Promise<GraphSlice & {degraded: boolean}> {
    q.rids.forEach(r => this.checkTenant(ctx, r));
    this.impactQueries.push(structuredClone(q));
    const s = subgraph(
      this.graph,
      q.rids,
      q.linkTypes ?? [],
      q.maxHops,
      q.limit,
    );
    for (let i = 0; i < this.inflate; i++) {
      s.nodes.push({
        rid: `ri.${ctx.tenantId}.Dummy.D${i}`,
        type: 'Dummy',
        title: `D${i}`,
        props: {},
      });
    }
    return {...s, degraded: this.degraded};
  }

  async getObjects(ctx: CallCtx, rids: Rid[]): Promise<ObjectDto[]> {
    rids.forEach(r => this.checkTenant(ctx, r));
    return rids
      .map(r => this.dto(ctx, r))
      .filter((o): o is ObjectDto => o !== null);
  }

  async evaluateObjectSet(
    ctx: CallCtx,
    def: ObjectSetDef,
    page: PageRequest = {},
  ): Promise<ObjectPage> {
    let nodes = this.graph.nodes.filter(
      n =>
        n.type === def.objectType &&
        parseRid(n.rid)?.tenantId === ctx.tenantId &&
        matchFilter(def.filter, n.props),
    );
    for (const o of [...(def.orderBy ?? [])].reverse()) {
      nodes = [...nodes].sort((a, b) => {
        const x = a.props[o.prop] as number;
        const y = b.props[o.prop] as number;
        return (x < y ? -1 : x > y ? 1 : 0) * (o.dir === 'asc' ? 1 : -1);
      });
    }
    const items = nodes
      .slice(0, page.limit ?? 50)
      .map(n => this.dto(ctx, n.rid)!)
      .filter(Boolean);
    return {items, nextCursor: null};
  }

  async applyAction(ctx: CallCtx, cmd: ApplyActionCmd): Promise<ActionResult> {
    this.checkTenant(ctx, cmd.target);
    const v = cmd.approval;
    const valid =
      v !== undefined &&
      v.tenantId === ctx.tenantId &&
      v.actionType === cmd.actionType &&
      v.target === cmd.target &&
      v.recommendationId === cmd.recommendationId &&
      (await verifyVoucher(this.secret, v, this.clock.now()));
    if (!valid)
      throw new AppError('APPROVAL_REQUIRED', 'Invalid approval voucher');
    if (this.failNext) {
      const code = this.failNext;
      this.failNext = undefined;
      throw new AppError(code as 'PRECONDITION_FAILED', 'Injected failure');
    }
    this.applied.push({ctx: structuredClone(ctx), cmd: structuredClone(cmd)});
    const node = this.graph.nodes.find(n => n.rid === cmd.target);
    return {
      actionLogId: `log-${++this.seq}`,
      actionType: cmd.actionType,
      rid: cmd.target,
      version: 2,
      before: {...(node?.props ?? {})},
      after: {...(node?.props ?? {})},
      writebackStatus: 'NONE',
      executedAt: this.clock.now().toISOString(),
    };
  }
}

/** Recording SITUATION stub. */
export class RecordingSituation implements Pick<
  SituationRpc,
  'pushRecommendation' | 'recordUsage'
> {
  readonly pushed: RecommendationSummary[] = [];
  readonly usage: {resource: UsageResource; n: number}[] = [];

  async pushRecommendation(
    _ctx: CallCtx,
    dto: RecommendationSummary,
  ): Promise<void> {
    this.pushed.push(dto);
  }

  async recordUsage(
    batch: {resource: UsageResource; n: number}[],
  ): Promise<UsageStatus> {
    this.usage.push(...batch);
    return {day: '2026-09-24', level: 'ok', ratios: {}, used: {}};
  }
}

/** ONTOLOGY stub serving the compiled supply-chain model. */
export class StaticOntology implements Pick<OntologyRpc, 'getActiveModel'> {
  constructor(private readonly model?: CompiledModel) {}

  async getActiveModel(ctx: CallCtx): Promise<CompiledModel> {
    return this.model ?? supplyChainModel(ctx.tenantId);
  }
}
