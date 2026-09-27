/**
 * @fileoverview Required request headers (修订说明书 10.1): `If-Match`
 * (parsed with parseEtag), `Idempotency-Key` (16–64 chars) and `X-Step-Up`
 * (passkey user-verification proof). A missing or malformed If-Match or
 * Idempotency-Key is 400 VALIDATION_FAILED; a missing step-up proof is 403
 * FORBIDDEN (详细设计 6.6). A recovery-code admin session may bind its new
 * passkey without a step-up proof (it has no usable passkey).
 */

import {
  AppError,
  IDEMPOTENCY_HEADER,
  STEP_UP_HEADER,
  isIdempotencyKey,
  parseEtag,
} from '@ontodecide/shared-kernel';
import type {Middleware} from './chain';

function headerError(name: string, message: string): AppError {
  return new AppError('VALIDATION_FAILED', `${name}: ${message}`, {
    extras: {errors: [{path: `header.${name}`, message}]},
  });
}

/** Required headers step. */
export function requiredHeaders(): Middleware {
  return async (s, next) => {
    const h = s.request.headers;
    const ifMatchRaw = h.get('if-match');
    if (ifMatchRaw !== null) s.ifMatch = parseEtag(ifMatchRaw) ?? undefined;
    const idem = h.get(IDEMPOTENCY_HEADER);
    if (idem !== null && isIdempotencyKey(idem)) s.idempotencyKey = idem;
    const stepUp = h.get(STEP_UP_HEADER)?.trim();
    if (stepUp && stepUp.length <= 4096) s.stepUp = stepUp;

    for (const req of s.route?.require ?? []) {
      if (req === 'If-Match' && s.ifMatch === undefined) {
        throw headerError('If-Match', ifMatchRaw ? 'Malformed' : 'Required');
      }
      if (req === 'Idempotency-Key' && !s.idempotencyKey) {
        throw headerError(IDEMPOTENCY_HEADER, idem ? 'Malformed' : 'Required');
      }
      if (req === 'X-Step-Up' && !s.stepUp) {
        const recovery =
          !!s.route?.recoveryOk && !!s.claims?.amr.includes('recovery');
        if (!recovery) {
          throw new AppError('FORBIDDEN', 'Passkey user verification required');
        }
      }
    }
    return next();
  };
}
