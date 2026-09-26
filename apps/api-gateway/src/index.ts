/**
 * @fileoverview Worker entry point of api-gateway. The only module (with
 * edge_guard.ts) importing `cloudflare:workers`.
 */

import {createApp, type GatewayApp} from './app';
import type {Env} from './env';

export {EdgeGuard} from './edge_guard';

let cache: {env: Env; app: GatewayApp} | undefined;

function appFor(env: Env): GatewayApp {
  if (cache?.env !== env) cache = {env, app: createApp(env)};
  return cache.app;
}

export default {
  fetch: (req, env, ctx) => appFor(env).fetch(req, ctx),
} satisfies ExportedHandler<Env>;
