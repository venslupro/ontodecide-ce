/**
 * @fileoverview Worker entry point of api-gateway (Workers Route
 * `ontodecide-ce.<domain>/api/*`). No Durable Object and no KV: the V1.3 EdgeGuard
 * class is deleted by the `v2` migration in wrangler.jsonc.
 */

import {createApp, type GatewayApp} from './app';
import type {Env} from './env';

let cache: {env: Env; app: GatewayApp} | undefined;

function appFor(env: Env): GatewayApp {
  if (cache?.env !== env) cache = {env, app: createApp(env)};
  return cache.app;
}

export default {
  fetch: (req, env, ctx) => appFor(env).fetch(req, ctx),
} satisfies ExportedHandler<Env>;
