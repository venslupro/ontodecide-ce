/**
 * @fileoverview Passkey step-up for high-risk admin writes (V2.4 #3): a
 * fresh user verification (`userVerification: 'required'`) proven to the
 * server, which returns a ≤ 5-minute token sent as `X-Step-Up`.
 */

import {api} from '../api/client';
import {getPasskey} from './webauthn';

/** POST /auth/passkeys/assertion (step_up) response. */
export interface StepUpResult {
  stepUpToken: string;
  expiresIn: number;
}

/** Runs the step-up ceremony and returns the step-up token. */
export async function requestStepUp(signal?: AbortSignal): Promise<string> {
  const options = await api.post<Record<string, unknown>>(
    '/auth/passkeys/options',
    {purpose: 'step_up'},
    {noActAs: true, signal},
  );
  const credential = await getPasskey(options, signal);
  const r = await api.post<StepUpResult>(
    '/auth/passkeys/assertion',
    {purpose: 'step_up', credential},
    {noActAs: true, signal},
  );
  return r.stepUpToken;
}
