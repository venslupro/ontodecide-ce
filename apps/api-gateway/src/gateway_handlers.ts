/**
 * @fileoverview Routes served by the gateway itself or forwarded as raw
 * protocol traffic: config, telemetry, health, WebSocket, webhook.
 */

import {AppError, CTX_HEADER, encodeCtx} from '@ontodecide/shared-kernel';
import type {Env} from './env';
import type {HandlerInput} from './route_types';

/** Feature flag defaults (overridden by KV key `features`). */
export const DEFAULT_FEATURES: Record<string, unknown> = {
  neo4j: false,
  aiMapping: true,
  darkTheme: true,
  wallMode: true,
};

const CONFIG_TTL_MS = 60_000;
const configCache = new WeakMap<
  Env,
  {at: number; features: Record<string, unknown>}
>();

/** GET /config: runtime feature flags. */
export async function getConfig(env: Env, now: number = Date.now()) {
  const cached = configCache.get(env);
  if (cached && now - cached.at < CONFIG_TTL_MS) {
    return {features: cached.features, version: env.APP_VERSION ?? 'dev'};
  }
  let overrides: Record<string, unknown> = {};
  try {
    const raw = (await env.CONFIG.get('features', 'json')) as unknown;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      overrides = raw as Record<string, unknown>;
    }
  } catch {
    // Fall back to defaults when KV is unavailable or holds bad JSON.
  }
  const features = {...DEFAULT_FEATURES, ...overrides};
  configCache.set(env, {at: now, features});
  return {features, version: env.APP_VERSION ?? 'dev'};
}

/** GET /health. */
export async function health(env: Env) {
  return {status: 'ok', version: env.APP_VERSION ?? 'dev'};
}

const TELEMETRY_MAX_EVENTS = 50;

/** POST /telemetry: frontend errors and web-vitals → Workers Logs. */
export async function telemetry(
  _env: Env,
  input: HandlerInput<unknown>,
): Promise<void> {
  const body = input.body;
  const events = Array.isArray(body) ? body : [body];
  if (
    events.length === 0 ||
    events.some(e => !e || typeof e !== 'object' || Array.isArray(e))
  ) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Expected an event object or an array of event objects',
    );
  }
  for (const event of events.slice(0, TELEMETRY_MAX_EVENTS)) {
    input.logger.info('telemetry', {
      requestId: input.ctx.requestId,
      event,
    });
  }
}

/**
 * GET /situation/stream: forwards the WebSocket upgrade to
 * situation-awareness with the verified context in `x-od-ctx` and returns
 * its response (101) untouched.
 */
export async function forwardStream(
  env: Env,
  input: HandlerInput,
): Promise<Response> {
  const {request, ctx} = input;
  if ((request.headers.get('upgrade') ?? '').toLowerCase() !== 'websocket') {
    throw new AppError('VALIDATION_FAILED', 'Expected a WebSocket upgrade');
  }
  const url = new URL(request.url);
  url.searchParams.delete('access_token');
  const headers = new Headers(request.headers);
  headers.delete('authorization');
  headers.delete('cookie');
  headers.set(CTX_HEADER, encodeCtx(ctx));
  return env.SITUATION.fetch(
    new Request(url.toString(), {method: 'GET', headers}),
  );
}

const WEBHOOK_HEADERS = ['x-od-signature', 'x-od-timestamp', 'content-type'];

/** POST /ingest/webhook/:sourceId: raw body + signature headers. */
export async function webhook(env: Env, input: HandlerInput) {
  const headers: Record<string, string> = {};
  for (const name of WEBHOOK_HEADERS) {
    const v = input.headers.get(name);
    if (v !== null) headers[name] = v;
  }
  return env.INTEGRATION.acceptWebhook(
    input.params.sourceId,
    headers,
    input.rawBody,
  );
}
