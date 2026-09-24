/**
 * @fileoverview Object Set evaluation (listObjects, evaluateObjectSet,
 * aggregate). Filters and sorts on indexed properties run in D1 through
 * og_prop_index; non-indexed ones are applied in memory only when the
 * candidate set has ≤ 200 objects. Search Around follows og_link for ≤ 2 hops.
 */

import type {
  CompiledModel,
  CompiledObjectType,
} from '@ontodecide/ontology/contract';
import {
  AppError,
  clampLimit,
  decodeCursor,
  encodeCursor,
  filterProps,
} from '@ontodecide/shared-kernel';
import type {
  CallCtx,
  FilterExpr,
  ObjectSetDef,
  OrderBy,
  PageRequest,
  Rid,
} from '@ontodecide/shared-kernel';
import type {AggregateQuery, ListObjectsQuery, ObjectPage} from '../contract';
import {
  IN_MEMORY_MAX,
  SEARCH_AROUND_MAX_HOPS,
  aggregateValues,
  filterObjects,
  hiddenPropNames,
  sortObjects,
  splitFilter,
} from '../domain';
import type {StoredObject} from '../domain';
import type {AppDeps} from './ports';
import {requireRole, toObjectDto} from './support';

/** Maximum objects reachable through Search Around (per step). */
export const SEARCH_AROUND_MAX_OBJECTS = 500;

/** Maximum objects aggregated in memory. */
export const AGGREGATE_IN_MEMORY_MAX = 2000;

const BUILTIN_SORT = new Set(['updatedAt', 'title']);

interface SetPlan {
  type: CompiledObjectType;
  indexed?: FilterExpr;
  residual?: FilterExpr;
  /** Order pushed down to D1 (indexed props / built-ins). */
  sqlOrder?: OrderBy[];
  /** Order applied in memory. */
  memOrder?: OrderBy[];
}

function invalid(detail: string): AppError {
  return new AppError('OBJECT_SET_INVALID', detail);
}

function checkProps(
  ctx: CallCtx,
  type: CompiledObjectType,
  props: readonly string[],
): void {
  const hidden = hiddenPropNames(ctx, type);
  for (const p of props) {
    if (!type.propsByName[p] && !BUILTIN_SORT.has(p)) {
      throw invalid(`Unknown property ${type.apiName}.${p}`);
    }
    if (hidden.has(p)) {
      throw new AppError('FORBIDDEN', `Property ${p} requires markings`);
    }
  }
}

function planOrder(
  type: CompiledObjectType,
  orderBy: readonly OrderBy[] | undefined,
): Pick<SetPlan, 'sqlOrder' | 'memOrder'> {
  if (!orderBy?.length) return {};
  const indexed = new Set(type.indexedProps);
  const pushable = orderBy.every(
    o =>
      indexed.has(o.prop) ||
      (BUILTIN_SORT.has(o.prop) && !type.propsByName[o.prop]),
  );
  return pushable ? {sqlOrder: [...orderBy]} : {memOrder: [...orderBy]};
}

/** Evaluates object sets for one caller. */
class ObjectSetEvaluator {
  constructor(private readonly d: AppDeps) {}

  plan(ctx: CallCtx, model: CompiledModel, def: ObjectSetDef): SetPlan {
    const type = model.objectTypes[def.objectType];
    if (!type) throw invalid(`Unknown object type ${def.objectType}`);
    if ((def.searchAround?.length ?? 0) > SEARCH_AROUND_MAX_HOPS) {
      throw invalid(
        `Search Around is limited to ${SEARCH_AROUND_MAX_HOPS} hops`,
      );
    }
    checkProps(ctx, type, filterProps(def.filter));
    const split = splitFilter(def.filter, new Set(type.indexedProps));
    const around = Boolean(def.searchAround?.length);
    if (!around)
      checkProps(
        ctx,
        type,
        (def.orderBy ?? []).map(o => o.prop),
      );
    return {
      type,
      ...split,
      ...(around ? {} : planOrder(type, def.orderBy)),
    };
  }

  /** Candidates of the start type (in-memory path, ≤ 200). */
  async candidates(ctx: CallCtx, plan: SetPlan): Promise<StoredObject[]> {
    const n = await this.d.reader.count(
      ctx.tenantId,
      plan.type.apiName,
      plan.indexed,
    );
    if (n > IN_MEMORY_MAX) {
      throw invalid(
        `Filtering or sorting on non-indexed properties needs ≤ ${IN_MEMORY_MAX} candidates (got ${n})`,
      );
    }
    const rows = await this.d.reader.query(ctx.tenantId, {
      type: plan.type.apiName,
      filter: plan.indexed,
      orderBy: plan.sqlOrder,
      offset: 0,
      limit: IN_MEMORY_MAX,
    });
    return filterObjects(rows, plan.residual);
  }

  /** Follows Search Around steps; returns the final type and objects. */
  async around(
    ctx: CallCtx,
    model: CompiledModel,
    def: ObjectSetDef,
    plan: SetPlan,
  ): Promise<{type: CompiledObjectType; objects: StoredObject[]}> {
    let rids: Rid[];
    if (plan.residual) {
      rids = (await this.candidates(ctx, plan)).map(o => o.rid);
    } else {
      rids = await this.d.reader.queryRids(
        ctx.tenantId,
        plan.type.apiName,
        plan.indexed,
        SEARCH_AROUND_MAX_OBJECTS + 1,
      );
    }
    if (rids.length > SEARCH_AROUND_MAX_OBJECTS) {
      throw invalid(
        `Search Around start set exceeds ${SEARCH_AROUND_MAX_OBJECTS} objects`,
      );
    }
    let typeName = plan.type.apiName;
    for (const step of def.searchAround ?? []) {
      const lt = model.linkTypes[step.link];
      if (!lt) throw invalid(`Unknown link type ${step.link}`);
      const from = step.direction === 'out' ? lt.from : lt.to;
      if (from !== typeName) {
        throw invalid(
          `Link ${step.link} (${step.direction}) does not start at ${typeName}`,
        );
      }
      typeName = step.direction === 'out' ? lt.to : lt.from;
      if (!rids.length) break;
      const edges = await this.d.reader.links(ctx.tenantId, rids, {
        direction: step.direction,
        linkTypes: [step.link],
      });
      const current = new Set(rids);
      const next = new Set<Rid>();
      for (const e of edges) {
        if (step.direction === 'out' && current.has(e.src)) next.add(e.dst);
        if (step.direction === 'in' && current.has(e.dst)) next.add(e.src);
      }
      rids = [...next];
      if (rids.length > SEARCH_AROUND_MAX_OBJECTS) {
        throw invalid(
          `Search Around result exceeds ${SEARCH_AROUND_MAX_OBJECTS} objects`,
        );
      }
    }
    const type = model.objectTypes[typeName];
    if (!type) throw invalid(`Unknown object type ${typeName}`);
    const objects = rids.length
      ? (await this.d.reader.getByRids(ctx.tenantId, rids)).filter(
          o => o.type === typeName,
        )
      : [];
    return {type, objects};
  }

  async page(
    ctx: CallCtx,
    def: ObjectSetDef,
    page: PageRequest = {},
  ): Promise<ObjectPage> {
    requireRole(ctx, 'Viewer');
    const limit = clampLimit(page.limit);
    const cursor = decodeCursor<{o?: number}>(page.cursor);
    if (
      page.cursor &&
      (!cursor || typeof cursor.o !== 'number' || cursor.o < 0)
    ) {
      throw invalid('Invalid cursor');
    }
    const offset = cursor?.o ?? 0;
    const model = await this.d.models.get(ctx);
    const plan = this.plan(ctx, model, def);
    const toPage = (all: StoredObject[]): ObjectPage => {
      const slice = all.slice(offset, offset + limit);
      return {
        items: slice.map(o => toObjectDto(ctx, model, o)),
        nextCursor:
          offset + limit < all.length
            ? encodeCursor({o: offset + limit})
            : null,
      };
    };

    if (def.searchAround?.length) {
      const {type, objects} = await this.around(ctx, model, def, plan);
      checkProps(
        ctx,
        type,
        (def.orderBy ?? []).map(o => o.prop),
      );
      return toPage(sortObjects(objects, def.orderBy));
    }
    if (plan.residual || plan.memOrder) {
      const rows = await this.candidates(ctx, plan);
      return toPage(plan.memOrder ? sortObjects(rows, plan.memOrder) : rows);
    }
    const rows = await this.d.reader.query(ctx.tenantId, {
      type: plan.type.apiName,
      filter: plan.indexed,
      orderBy: plan.sqlOrder,
      offset,
      limit: limit + 1,
    });
    return {
      items: rows.slice(0, limit).map(o => toObjectDto(ctx, model, o)),
      nextCursor:
        rows.length > limit ? encodeCursor({o: offset + limit}) : null,
    };
  }

  async aggregate(ctx: CallCtx, q: AggregateQuery): Promise<number> {
    requireRole(ctx, 'Viewer');
    const def = q.objectSet;
    if (q.fn !== 'count' && !q.prop) {
      throw new AppError('VALIDATION_FAILED', `${q.fn} requires a property`);
    }
    const model = await this.d.models.get(ctx);
    const plan = this.plan(ctx, model, {...def, orderBy: undefined});
    const values = (objects: StoredObject[]) =>
      q.fn === 'count' ? objects : objects.map(o => o.props[q.prop!]);

    if (def.searchAround?.length) {
      const {type, objects} = await this.around(ctx, model, def, plan);
      if (q.prop) checkProps(ctx, type, [q.prop]);
      return aggregateValues(q.fn, values(objects));
    }
    if (q.prop) checkProps(ctx, plan.type, [q.prop]);
    if (plan.residual) {
      return aggregateValues(q.fn, values(await this.candidates(ctx, plan)));
    }
    if (q.fn === 'count') {
      return this.d.reader.count(ctx.tenantId, plan.type.apiName, plan.indexed);
    }
    if (plan.type.indexedProps.includes(q.prop!)) {
      return this.d.reader.aggregateIndexed(
        ctx.tenantId,
        plan.type.apiName,
        plan.indexed,
        q.prop!,
        q.fn,
      );
    }
    const n = await this.d.reader.count(
      ctx.tenantId,
      plan.type.apiName,
      plan.indexed,
    );
    if (n > AGGREGATE_IN_MEMORY_MAX) {
      throw invalid(
        `Aggregating non-indexed ${q.prop} needs ≤ ${AGGREGATE_IN_MEMORY_MAX} objects`,
      );
    }
    const all: StoredObject[] = [];
    for (let offset = 0; offset < n; offset += IN_MEMORY_MAX) {
      all.push(
        ...(await this.d.reader.query(ctx.tenantId, {
          type: plan.type.apiName,
          filter: plan.indexed,
          offset,
          limit: IN_MEMORY_MAX,
        })),
      );
    }
    return aggregateValues(q.fn, values(all));
  }
}

/** Use case: evaluate an ad-hoc Object Set. */
export class EvaluateObjectSet {
  private readonly evaluator: ObjectSetEvaluator;
  constructor(d: AppDeps) {
    this.evaluator = new ObjectSetEvaluator(d);
  }

  handle(
    ctx: CallCtx,
    def: ObjectSetDef,
    page?: PageRequest,
  ): Promise<ObjectPage> {
    return this.evaluator.page(ctx, def, page);
  }
}

/** Use case: list objects of one type. */
export class ListObjects {
  private readonly evaluator: ObjectSetEvaluator;
  constructor(d: AppDeps) {
    this.evaluator = new ObjectSetEvaluator(d);
  }

  handle(
    ctx: CallCtx,
    type: string,
    q: ListObjectsQuery = {},
  ): Promise<ObjectPage> {
    return this.evaluator.page(
      ctx,
      {objectType: type, filter: q.filter, orderBy: q.orderBy},
      {cursor: q.cursor, limit: q.limit},
    );
  }
}

/** Use case: aggregate over an Object Set (KPIs). */
export class AggregateObjects {
  private readonly evaluator: ObjectSetEvaluator;
  constructor(d: AppDeps) {
    this.evaluator = new ObjectSetEvaluator(d);
  }

  handle(ctx: CallCtx, q: AggregateQuery): Promise<number> {
    return this.evaluator.aggregate(ctx, q);
  }
}
