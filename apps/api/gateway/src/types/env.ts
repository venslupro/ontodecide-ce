/**
 * Environment bindings for the Gateway Worker.
 *
 * Identity is the single point of JWT verification — downstream services
 * trust the Gateway-injected `x-tenant-id` headers and the internal-call
 * marker. Service Bindings ({@link GatewayServiceBindings}) replace the
 * old HTTP URL model for zero-cost, in-account Worker-to-Worker calls.
 */
import type { AuthEnv, GatewayServiceBindings } from '@ontodecide/shared';

export interface GatewayEnv extends AuthEnv, GatewayServiceBindings {
  /** KV namespace holding per-tenant rate-limit counters. */
  RATE_LIMIT: KVNamespace;
}
