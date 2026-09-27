/**
 * @fileoverview Automation CRUD (alert-only). ≤ 3 scheduled rules per
 * workspace, interval ≥ 1 h (VALIDATION_FAILED); writes are conditional on
 * the version (If-Match → PRECONDITION_FAILED).
 */

import {
  AppError,
  type CallCtx,
  notFound,
  ulid,
} from '@ontodecide/shared-kernel';
import type {AutomationDef, AutomationDto} from '../contract/types';
import {firstRunAt, validateAutomation} from '../domain';
import {ensureInitialized} from './install_pack_content';
import type {AlertRecord, AutomationRecord} from './ports';
import {type RoomRuntime, toAutomationDto} from './support';
import {checkObjectType, parseAutomationDef} from './validation';

async function prepare(rt: RoomRuntime, ctx: CallCtx): Promise<void> {
  const reactivated = rt.touch(ctx);
  await ensureInitialized(rt);
  if (reactivated) await rt.reschedule();
}

/** Lists the workspace's automations. */
export async function listAutomations(
  rt: RoomRuntime,
  ctx: CallCtx,
): Promise<AutomationDto[]> {
  await prepare(rt, ctx);
  return rt.deps.store.listAutomations().map(toAutomationDto);
}

/** Reads one automation (NOT_FOUND). */
export async function getAutomation(
  rt: RoomRuntime,
  ctx: CallCtx,
  id: string,
): Promise<AutomationDto> {
  await prepare(rt, ctx);
  const a = rt.deps.store.getAutomation(id);
  if (!a) notFound('Automation not found');
  return toAutomationDto(a);
}

function checkVersion(
  a: AutomationRecord | null,
  ifMatch: number,
): AutomationRecord {
  if (!a) notFound('Automation not found');
  if (a.version !== ifMatch) {
    throw new AppError('PRECONDITION_FAILED', 'Automation version mismatch', {
      extras: {currentVersion: a.version},
    });
  }
  return a;
}

/**
 * Re-evaluates a rule after it changed: threshold rules over every cached
 * object of the type; alerts that no longer apply close.
 */
function reevaluate(rt: RoomRuntime, rule: AutomationRecord): void {
  const store = rt.deps.store;
  const out: AlertRecord[] = [];
  const done = new Set<string>();
  if (rule.trigger === 'threshold' && rule.enabled) {
    for (const o of store.listObjects(rule.objectType)) {
      done.add(o.rid);
      rt.evaluate(rule, o.rid, o, out);
    }
  }
  for (const a of store.activeAlertsOf(rule.id)) {
    if (!a.rid || done.has(a.rid)) continue;
    rt.evaluate(rule, a.rid, store.getObject(a.rid), out);
  }
  rt.pushAlerts(out);
}

/** Creates an automation. */
export async function createAutomation(
  rt: RoomRuntime,
  ctx: CallCtx,
  input: AutomationDef,
): Promise<AutomationDto> {
  const def = parseAutomationDef(input);
  await prepare(rt, ctx);
  await checkObjectType(rt.deps.ontology, ctx, def.objectType);
  const store = rt.deps.store;
  const normalized = validateAutomation(def, store.countScheduled());
  const now = rt.now();
  const rec: AutomationRecord = {
    ...normalized,
    id: ulid(now),
    version: 1,
    nextRunAt:
      normalized.trigger === 'schedule' && normalized.everyHours
        ? firstRunAt(now, normalized.everyHours)
        : null,
    lastFiredAt: null,
    createdAt: now,
  };
  store.insertAutomation(rec);
  rt.rulesChanged();
  reevaluate(rt, rec);
  await rt.reschedule();
  return toAutomationDto(store.getAutomation(rec.id)!);
}

/** Replaces an automation when `ifMatch` equals its version. */
export async function putAutomation(
  rt: RoomRuntime,
  ctx: CallCtx,
  id: string,
  input: AutomationDef,
  ifMatch: number,
): Promise<AutomationDto> {
  const def = parseAutomationDef(input);
  await prepare(rt, ctx);
  checkVersion(rt.deps.store.getAutomation(id), ifMatch);
  await checkObjectType(rt.deps.ontology, ctx, def.objectType);
  const store = rt.deps.store;
  const existing = checkVersion(store.getAutomation(id), ifMatch);
  const normalized = validateAutomation(def, store.countScheduled(id));
  const now = rt.now();
  const keepSchedule =
    existing.trigger === 'schedule' &&
    normalized.trigger === 'schedule' &&
    existing.everyHours === normalized.everyHours &&
    existing.nextRunAt !== null;
  const {everyHours: _drop, ...base} = existing;
  const rec: AutomationRecord = {
    ...base,
    ...normalized,
    id,
    version: existing.version + 1,
    nextRunAt:
      normalized.trigger !== 'schedule' || !normalized.everyHours
        ? null
        : keepSchedule
          ? existing.nextRunAt
          : firstRunAt(now, normalized.everyHours),
  };
  store.updateAutomation(rec);
  rt.rulesChanged();
  reevaluate(rt, rec);
  await rt.reschedule();
  return toAutomationDto(store.getAutomation(id)!);
}

/** Deletes an automation (its active alerts close; history is kept). */
export async function deleteAutomation(
  rt: RoomRuntime,
  ctx: CallCtx,
  id: string,
  ifMatch: number,
): Promise<void> {
  await prepare(rt, ctx);
  const store = rt.deps.store;
  checkVersion(store.getAutomation(id), ifMatch);
  const now = rt.now();
  const closed: AlertRecord[] = [];
  for (const a of store.activeAlertsOf(id)) {
    const c: AlertRecord = {...a, status: 'CLOSED', closedAt: now};
    store.updateAlert(c);
    closed.push(c);
  }
  store.deleteAutomation(id);
  rt.rulesChanged();
  rt.pushAlerts(closed);
  await rt.reschedule();
}
