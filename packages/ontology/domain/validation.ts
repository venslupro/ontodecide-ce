/**
 * @fileoverview Structural validation of an ontology schema: unique api
 * names, resolvable references (types, properties, links, parameters),
 * supported JSONLogic operators and consistent simulation KPIs. Also checks
 * api-name uniqueness across the schemas of a tenant.
 */

import {assertLogic, type JsonLogic} from '@ontodecide/shared-kernel';
import type {
  ActionTypeDef,
  DataType,
  ObjectTypeDef,
  PropertyDef,
  SchemaDef,
  ValidationIssue,
} from '../contract';

const OBJECT_REF_PREFIX = 'objectRef:';
const NUMERIC_TYPES = new Set<string>(['integer', 'double']);

/** Returns the referenced type of an `objectRef:<T>` data type, else null. */
export function objectRefTarget(dataType: DataType | string): string | null {
  return dataType.startsWith(OBJECT_REF_PREFIX)
    ? dataType.slice(OBJECT_REF_PREFIX.length)
    : null;
}

/** Collects the full `var` paths referenced by a JSONLogic expression. */
export function logicVarPaths(expr: JsonLogic): string[] {
  const out = new Set<string>();
  const walk = (e: JsonLogic): void => {
    if (Array.isArray(e)) return e.forEach(walk);
    if (e === null || typeof e !== 'object') return;
    for (const [k, v] of Object.entries(e)) {
      if (k === 'var') {
        const p = Array.isArray(v) ? v[0] : v;
        if (typeof p === 'string' && p) out.add(p);
        if (Array.isArray(v)) v.slice(1).forEach(walk);
      } else {
        walk(v);
      }
    }
  };
  walk(expr);
  return [...out];
}

/** Collects the property names a FilterExpr-shaped value refers to. */
function filterProps(filter: unknown): string[] {
  const out: string[] = [];
  const walk = (f: unknown): void => {
    if (!f || typeof f !== 'object') return;
    const node = f as Record<string, unknown>;
    if (typeof node.prop === 'string') out.push(node.prop);
    if (Array.isArray(node.args)) node.args.forEach(walk);
    if (node.arg) walk(node.arg);
  };
  walk(filter);
  return out;
}

class IssueCollector {
  readonly issues: ValidationIssue[] = [];
  add(path: string, message: string): void {
    this.issues.push({path, message});
  }
  /** Reports duplicate api names within a list. */
  unique(items: readonly {apiName: string}[], path: string, what: string) {
    const seen = new Set<string>();
    items.forEach((item, i) => {
      if (seen.has(item.apiName)) {
        this.add(
          `${path}.${i}.apiName`,
          `Duplicate ${what} api name: ${item.apiName}`,
        );
      }
      seen.add(item.apiName);
    });
  }
  /** Reports an unsupported JSONLogic operator. */
  logic(expr: JsonLogic, path: string): void {
    try {
      assertLogic(expr);
    } catch (e) {
      this.add(path, e instanceof Error ? stripMarker(e) : String(e));
    }
  }
}

function stripMarker(e: Error): string {
  const detail = (e as {detail?: unknown}).detail;
  return typeof detail === 'string' ? detail : e.message;
}

/**
 * Validates a schema definition structurally. Returns an empty list when the
 * schema is consistent.
 */
export function validateSchema(def: SchemaDef): ValidationIssue[] {
  const c = new IssueCollector();
  const types = new Map<string, ObjectTypeDef>();
  for (const t of def.objectTypes) {
    if (!types.has(t.apiName)) types.set(t.apiName, t);
  }
  const links = new Map(def.linkTypes.map(l => [l.apiName, l]));
  const propOf = (type: string, prop: string): PropertyDef | undefined =>
    types.get(type)?.properties.find(p => p.apiName === prop);

  c.unique(def.objectTypes, 'objectTypes', 'object type');
  c.unique(def.linkTypes, 'linkTypes', 'link type');
  c.unique(def.actionTypes, 'actionTypes', 'action type');
  c.unique(def.functions, 'functions', 'function');
  c.unique(def.simulationKpis ?? [], 'simulationKpis', 'simulation KPI');

  const checkRef = (dataType: string, path: string): void => {
    const target = objectRefTarget(dataType);
    if (target !== null && !types.has(target)) {
      c.add(path, `Referenced object type does not exist: ${target}`);
    }
  };

  def.objectTypes.forEach((t, ti) => {
    const base = `objectTypes.${ti}`;
    c.unique(t.properties, `${base}.properties`, 'property');
    const names = new Set(t.properties.map(p => p.apiName));
    if (!names.has(t.primaryKey)) {
      c.add(
        `${base}.primaryKey`,
        `Primary key property does not exist: ${t.primaryKey}`,
      );
    }
    if (!names.has(t.titleProperty)) {
      c.add(
        `${base}.titleProperty`,
        `Title property does not exist: ${t.titleProperty}`,
      );
    }
    t.properties.forEach((p, pi) => {
      const path = `${base}.properties.${pi}`;
      checkRef(p.dataType, `${path}.dataType`);
      if (p.dataType === 'enum' && !(p.enumValues && p.enumValues.length)) {
        c.add(`${path}.enumValues`, 'Enum properties need at least one value');
      }
    });
  });

  def.linkTypes.forEach((l, li) => {
    const base = `linkTypes.${li}`;
    if (!types.has(l.from))
      c.add(`${base}.from`, `Object type does not exist: ${l.from}`);
    if (!types.has(l.to))
      c.add(`${base}.to`, `Object type does not exist: ${l.to}`);
  });

  def.actionTypes.forEach((a, ai) =>
    validateAction(c, a, `actionTypes.${ai}`, types, links, propOf, checkRef),
  );

  def.functions.forEach((f, fi) => {
    const base = `functions.${fi}`;
    c.logic(f.expr, `${base}.expr`);
    checkRef(f.returns, `${base}.returns`);
    if (f.objectType !== undefined) {
      if (!types.has(f.objectType)) {
        c.add(
          `${base}.objectType`,
          `Object type does not exist: ${f.objectType}`,
        );
      } else {
        for (const v of logicVarPaths(f.expr)) {
          const prop = v.split('.')[0];
          if (!propOf(f.objectType, prop)) {
            c.add(
              `${base}.expr`,
              `Unknown property of ${f.objectType}: ${prop}`,
            );
          }
        }
      }
    }
  });

  (def.simulationKpis ?? []).forEach((k, ki) => {
    const base = `simulationKpis.${ki}`;
    if (!types.has(k.objectType)) {
      c.add(
        `${base}.objectType`,
        `Object type does not exist: ${k.objectType}`,
      );
      return;
    }
    if (k.agg === 'count') {
      if (k.property !== undefined && !propOf(k.objectType, k.property)) {
        c.add(
          `${base}.property`,
          `Unknown property of ${k.objectType}: ${k.property}`,
        );
      }
      return;
    }
    if (k.property === undefined) {
      c.add(`${base}.property`, `Aggregation ${k.agg} needs a property`);
      return;
    }
    const p = propOf(k.objectType, k.property);
    if (!p) {
      c.add(
        `${base}.property`,
        `Unknown property of ${k.objectType}: ${k.property}`,
      );
    } else if (!NUMERIC_TYPES.has(p.dataType)) {
      c.add(
        `${base}.property`,
        `Aggregation ${k.agg} needs a numeric property`,
      );
    }
  });

  return c.issues;
}

function validateAction(
  c: IssueCollector,
  a: ActionTypeDef,
  base: string,
  types: Map<string, ObjectTypeDef>,
  links: Map<string, SchemaDef['linkTypes'][number]>,
  propOf: (type: string, prop: string) => PropertyDef | undefined,
  checkRef: (dataType: string, path: string) => void,
): void {
  c.unique(a.parameters, `${base}.parameters`, 'parameter');
  const target = types.get(a.targetType);
  if (!target) {
    c.add(`${base}.targetType`, `Object type does not exist: ${a.targetType}`);
  }
  const params = new Map(a.parameters.map(p => [p.apiName, p]));

  a.parameters.forEach((p, pi) => {
    const path = `${base}.parameters.${pi}`;
    checkRef(p.dataType, `${path}.dataType`);
    if (!p.suggest) return;
    const s = p.suggest;
    if (!types.has(s.objectType)) {
      c.add(
        `${path}.suggest.objectType`,
        `Object type does not exist: ${s.objectType}`,
      );
    } else {
      if (!propOf(s.objectType, s.orderBy.prop)) {
        c.add(
          `${path}.suggest.orderBy.prop`,
          `Unknown property of ${s.objectType}: ${s.orderBy.prop}`,
        );
      }
      for (const prop of filterProps(s.filter)) {
        if (!propOf(s.objectType, prop)) {
          c.add(
            `${path}.suggest.filter`,
            `Unknown property of ${s.objectType}: ${prop}`,
          );
        }
      }
    }
    if (s.sharesLinkWithTarget && !links.has(s.sharesLinkWithTarget.link)) {
      c.add(
        `${path}.suggest.sharesLinkWithTarget.link`,
        `Link type does not exist: ${s.sharesLinkWithTarget.link}`,
      );
    }
  });

  // JSONLogic data context is {target, params}.
  const checkVars = (expr: JsonLogic, path: string): void => {
    c.logic(expr, path);
    for (const v of logicVarPaths(expr)) {
      const [root, name] = v.split('.');
      if (root === 'params') {
        if (name !== undefined && !params.has(name)) {
          c.add(path, `Unknown parameter: ${name}`);
        }
      } else if (root === 'target') {
        if (name !== undefined && target && !propOf(a.targetType, name)) {
          c.add(path, `Unknown property of ${a.targetType}: ${name}`);
        }
      } else {
        c.add(path, `Variables must start with target. or params.: ${v}`);
      }
    }
  };

  a.preconditions.forEach((p, i) =>
    checkVars(p.expr, `${base}.preconditions.${i}.expr`),
  );

  a.effects.forEach((e, ei) => {
    const path = `${base}.effects.${ei}`;
    if (e.kind === 'set' || e.kind === 'increment') {
      checkVars(
        e.kind === 'set' ? e.value : e.by,
        `${path}.${e.kind === 'set' ? 'value' : 'by'}`,
      );
      if (!target) return;
      const p = propOf(a.targetType, e.prop);
      if (!p) {
        c.add(`${path}.prop`, `Unknown property of ${a.targetType}: ${e.prop}`);
      } else if (e.kind === 'increment' && !NUMERIC_TYPES.has(p.dataType)) {
        c.add(`${path}.prop`, `Increment needs a numeric property: ${e.prop}`);
      }
      return;
    }
    const link = links.get(e.link);
    if (!link) {
      c.add(`${path}.link`, `Link type does not exist: ${e.link}`);
    } else if (target) {
      const near = e.direction === 'in' ? link.to : link.from;
      if (near !== a.targetType) {
        c.add(
          `${path}.direction`,
          `Link ${e.link} (${e.direction}) does not attach to ${a.targetType}`,
        );
      }
    }
    if (e.toParam !== undefined) {
      const param = params.get(e.toParam);
      if (!param) {
        c.add(`${path}.toParam`, `Unknown parameter: ${e.toParam}`);
      } else if (link) {
        const far = e.direction === 'in' ? link.from : link.to;
        const ref = objectRefTarget(param.dataType);
        if (ref !== null && ref !== far) {
          c.add(
            `${path}.toParam`,
            `Parameter ${e.toParam} must reference ${far}`,
          );
        }
      }
    }
  });

  // Impact hints name the perturbed property, which may live on an upstream
  // type (e.g. switchSupplier on Material restores Supplier.capacity), so
  // only require the property to exist somewhere in the schema.
  (a.impact ?? []).forEach((h, hi) => {
    const known = [...types.values()].some(t =>
      t.properties.some(p => p.apiName === h.property),
    );
    if (!known) {
      c.add(`${base}.impact.${hi}.property`, `Unknown property: ${h.property}`);
    }
  });
}

/** Api names a schema contributes to the tenant-wide model. */
export interface SchemaNames {
  apiName: string;
  objectTypes: string[];
  linkTypes: string[];
  actionTypes: string[];
  functions: string[];
}

/** Extracts the tenant-wide api names of a schema. */
export function schemaNames(def: SchemaDef): SchemaNames {
  return {
    apiName: def.apiName,
    objectTypes: def.objectTypes.map(t => t.apiName),
    linkTypes: def.linkTypes.map(l => l.apiName),
    actionTypes: def.actionTypes.map(a => a.apiName),
    functions: def.functions.map(f => f.apiName),
  };
}

/**
 * Checks that object, link, action and function api names of `def` do not
 * clash with those of the tenant's other schemas (same-api schemas are
 * ignored, since they are replaced).
 */
export function checkCrossSchemaConflicts(
  def: SchemaDef,
  others: readonly SchemaNames[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const kinds = [
    ['objectTypes', 'Object type'],
    ['linkTypes', 'Link type'],
    ['actionTypes', 'Action type'],
    ['functions', 'Function'],
  ] as const;
  const mine = schemaNames(def);
  for (const other of others) {
    if (other.apiName === def.apiName) continue;
    for (const [kind, label] of kinds) {
      const theirs = new Set(other[kind]);
      mine[kind].forEach((name, i) => {
        if (theirs.has(name)) {
          issues.push({
            path: `${kind}.${i}.apiName`,
            message: `${label} ${name} is already defined by schema ${other.apiName}`,
          });
        }
      });
    }
  }
  return issues;
}
