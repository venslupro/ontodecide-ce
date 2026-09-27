/**
 * @fileoverview Rate limit step (详细设计 6.3.5): `read` / `write` by user
 * (RL_USER_READ / RL_USER_WRITE), `email` by the normalized e-mail of the
 * body (RL_EMAIL), `ip` by CF-Connecting-IP (RL_IP_AUTH). 429 RATE_LIMITED
 * with Retry-After (the binding windows are 60 s). Nothing is written to D1.
 */

import {AppError} from '@ontodecide/shared-kernel';
import type {Env} from '../env';
import type {RateClass} from '../route_types';
import type {GatewayDeps, GatewayState, Middleware} from './chain';

/** Window of every Rate Limiting binding, seconds. */
export const RATE_WINDOW_S = 60;

const BINDING: Record<RateClass, keyof Env> = {
  read: 'RL_USER_READ',
  write: 'RL_USER_WRITE',
  email: 'RL_EMAIL',
  ip: 'RL_IP_AUTH',
};

/** Normalized e-mail of a JSON body, if any (rate key only). */
export function emailKey(rawBody: string): string | undefined {
  try {
    const v = (JSON.parse(rawBody) as {email?: unknown}).email;
    return typeof v === 'string' && v.trim()
      ? v.trim().toLowerCase()
      : undefined;
  } catch {
    return undefined;
  }
}

function keyFor(cls: RateClass, s: GatewayState): string | undefined {
  switch (cls) {
    case 'read':
    case 'write':
      return s.ctx ? `u:${s.ctx.sub}` : undefined;
    case 'email': {
      const e = emailKey(s.rawBody);
      return e ? `e:${e}` : undefined;
    }
    case 'ip':
      return `ip:${s.ip}`;
  }
}

/** Rate limit step. */
export function rateLimit(deps: GatewayDeps): Middleware {
  return async (s, next) => {
    for (const cls of s.route?.rate ?? []) {
      const key = keyFor(cls, s);
      if (!key) continue;
      const binding = deps.env[BINDING[cls]] as RateLimit;
      const {success} = await binding.limit({key});
      if (!success) {
        throw new AppError('RATE_LIMITED', `Rate limit (${cls})`, {
          extras: {retryAfter: RATE_WINDOW_S},
        });
      }
    }
    return next();
  };
}
