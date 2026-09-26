/**
 * @fileoverview A safe JSONLogic subset used for declarative ontology
 * functions, action preconditions and effects. Supports arithmetic,
 * comparison, logic, `var` and `if`. No eval; bounded to 1,000 steps.
 */

import {AppError} from './errors';

/** A JSONLogic expression. */
export type JsonLogic =
  null | boolean | number | string | JsonLogic[] | {[op: string]: JsonLogic};

/** Maximum evaluation steps per call. */
export const JSON_LOGIC_MAX_STEPS = 1000;

const OPS = new Set([
  'var',
  'if',
  '==',
  '!=',
  '===',
  '!==',
  '>',
  '>=',
  '<',
  '<=',
  '!',
  '!!',
  'and',
  'or',
  '+',
  '-',
  '*',
  '/',
  '%',
  'min',
  'max',
  'in',
  'cat',
  'abs',
  'round',
]);

function getVar(data: unknown, path: string): unknown {
  if (path === '') return data;
  let cur: unknown = data;
  for (const key of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object')
      return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return Boolean(v);
}

/** Evaluates a JSONLogic expression against data. */
export function evalLogic(expr: JsonLogic, data: unknown): unknown {
  let steps = 0;
  const run = (e: JsonLogic): unknown => {
    if (++steps > JSON_LOGIC_MAX_STEPS) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Expression exceeded the step limit',
      );
    }
    if (Array.isArray(e)) return e.map(run);
    if (e === null || typeof e !== 'object') return e;
    const keys = Object.keys(e);
    if (keys.length !== 1) return e;
    const op = keys[0];
    if (!OPS.has(op))
      throw new AppError('VALIDATION_FAILED', `Unsupported operator: ${op}`);
    const raw = e[op];
    const args: JsonLogic[] = Array.isArray(raw) ? raw : [raw];
    switch (op) {
      case 'var': {
        const path = run(args[0]);
        const v = getVar(
          data,
          path === null || path === undefined ? '' : String(path),
        );
        return v === undefined && args.length > 1 ? run(args[1]) : v;
      }
      case 'if': {
        for (let i = 0; i < args.length - 1; i += 2) {
          if (truthy(run(args[i]))) return run(args[i + 1]);
        }
        return args.length % 2 === 1 ? run(args[args.length - 1]) : null;
      }
      case 'and': {
        let last: unknown = true;
        for (const a of args) {
          last = run(a);
          if (!truthy(last)) return last;
        }
        return last;
      }
      case 'or': {
        let last: unknown = false;
        for (const a of args) {
          last = run(a);
          if (truthy(last)) return last;
        }
        return last;
      }
      default:
        break;
    }
    const v = args.map(run);
    const n = v.map(x => Number(x));
    switch (op) {
      case '==':
        // eslint-disable-next-line eqeqeq
        return v[0] == v[1];
      case '!=':
        // eslint-disable-next-line eqeqeq
        return v[0] != v[1];
      case '===':
        return v[0] === v[1];
      case '!==':
        return v[0] !== v[1];
      case '>':
        return n[0] > n[1];
      case '>=':
        return n[0] >= n[1];
      case '<':
        return v.length === 3 ? n[0] < n[1] && n[1] < n[2] : n[0] < n[1];
      case '<=':
        return v.length === 3 ? n[0] <= n[1] && n[1] <= n[2] : n[0] <= n[1];
      case '!':
        return !truthy(v[0]);
      case '!!':
        return truthy(v[0]);
      case '+':
        return n.reduce((a, b) => a + b, 0);
      case '-':
        return n.length === 1 ? -n[0] : n[0] - n[1];
      case '*':
        return n.reduce((a, b) => a * b, 1);
      case '/':
        return n[1] === 0 ? null : n[0] / n[1];
      case '%':
        return n[1] === 0 ? null : n[0] % n[1];
      case 'min':
        return Math.min(...n);
      case 'max':
        return Math.max(...n);
      case 'abs':
        return Math.abs(n[0]);
      case 'round':
        return Math.round(n[0] * 10 ** (n[1] || 0)) / 10 ** (n[1] || 0);
      case 'cat':
        return v
          .map(x => (x === null || x === undefined ? '' : String(x)))
          .join('');
      case 'in':
        if (Array.isArray(v[1])) return v[1].includes(v[0]);
        return typeof v[1] === 'string' && v[1].includes(String(v[0]));
      default:
        throw new AppError('VALIDATION_FAILED', `Unsupported operator: ${op}`);
    }
  };
  return run(expr);
}

/** Collects `var` paths referenced by an expression (top-level segment). */
export function logicVars(expr: JsonLogic): string[] {
  const out = new Set<string>();
  const walk = (e: JsonLogic): void => {
    if (Array.isArray(e)) return e.forEach(walk);
    if (e === null || typeof e !== 'object') return;
    for (const [k, v] of Object.entries(e)) {
      if (k === 'var') {
        const p = Array.isArray(v) ? v[0] : v;
        if (typeof p === 'string' && p) out.add(p.split('.')[0]);
      } else {
        walk(v);
      }
    }
  };
  walk(expr);
  return [...out];
}

/** Validates operator usage without evaluating; throws on unknown ops. */
export function assertLogic(expr: JsonLogic): void {
  const walk = (e: JsonLogic): void => {
    if (Array.isArray(e)) return e.forEach(walk);
    if (e === null || typeof e !== 'object') return;
    const keys = Object.keys(e);
    if (keys.length === 1 && !OPS.has(keys[0])) {
      throw new AppError(
        'ONTOLOGY_INVALID',
        `Unsupported operator: ${keys[0]}`,
      );
    }
    Object.values(e).forEach(walk);
  };
  walk(expr);
}
