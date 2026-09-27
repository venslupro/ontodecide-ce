/**
 * @fileoverview Identity endpoints used by sign-up, login, the account page
 * and the public archive-deletion page (前端详细设计 表 9). E-mail codes
 * only (no passwords); the admin adds a passkey (or a recovery code).
 */

import type {
  ArchiveDeletionInfo,
  MeDto,
  PasskeyDto,
} from '@ontodecide/identity/contract';
import type {Locale, Quotas} from '@ontodecide/shared-kernel';
import {LIFECYCLE} from '@ontodecide/shared-kernel';
import type {QueryClient} from '@tanstack/react-query';
import {useSession, type Me} from '../../entities/session/store';
import {api, apiRaw, idempotencyKey} from '../../shared/api/client';
import {qk} from '../../shared/api/query_keys';

/** Code purposes of the public endpoint. */
export type CodePurpose = 'signup' | 'login';

/** An issued session as returned to the browser (refresh token is a cookie). */
export interface BrowserSession {
  kind: 'session';
  accessToken: string;
  expiresIn: number;
  me?: Me;
}

/** The admin's code was accepted; a passkey (or setup) must follow. */
export interface PasskeyStep {
  kind: 'passkeyRequired';
  preAuth: string;
  setupRequired: boolean;
}

/** Result of POST /auth/sessions. */
export type SessionOutcome = BrowserSession | PasskeyStep;

type RawSession = Partial<{
  kind: string;
  passkeyRequired: boolean;
  preAuth: string;
  setupRequired: boolean;
  accessToken: string;
  expiresIn: number;
  me: MeDto & {quotas?: Quotas};
  session: RawSession;
}>;

/** Normalizes the documented response shapes into a {@link SessionOutcome}. */
export function toOutcome(raw: RawSession): SessionOutcome {
  if (raw.kind === 'passkeyRequired' || raw.passkeyRequired) {
    return {
      kind: 'passkeyRequired',
      preAuth: raw.preAuth ?? '',
      setupRequired: !!raw.setupRequired,
    };
  }
  const s = raw.accessToken ? raw : (raw.session ?? raw);
  if (!s.accessToken) throw new Error('No session in response');
  return {
    kind: 'session',
    accessToken: s.accessToken,
    expiresIn: s.expiresIn ?? LIFECYCLE.accessTokenMin * 60,
    me: s.me,
  };
}

/** POST /auth/codes → 202 (whether or not the e-mail exists). */
export function sendCode(input: {
  email: string;
  purpose: CodePurpose;
  turnstileToken: string;
  locale: Locale;
}): Promise<void> {
  return api.post<void>('/auth/codes', input, {auth: false});
}

/** POST /auth/sessions. */
export async function createSession(input: {
  email: string;
  code: string;
  purpose: CodePurpose;
}): Promise<SessionOutcome> {
  return toOutcome(
    await api.post<RawSession>('/auth/sessions', input, {auth: false}),
  );
}

/** POST /auth/passkeys/options (login, with preAuth). */
export function passkeyLoginOptions(
  preAuth: string,
): Promise<Record<string, unknown>> {
  return api.post(
    '/auth/passkeys/options',
    {purpose: 'login', preAuth},
    {
      auth: false,
    },
  );
}

/** POST /auth/passkeys/assertion (login) → admin session. */
export async function passkeyLogin(
  preAuth: string,
  credential: Record<string, unknown>,
): Promise<BrowserSession> {
  const o = toOutcome(
    await api.post<RawSession>(
      '/auth/passkeys/assertion',
      {purpose: 'login', preAuth, credential},
      {auth: false},
    ),
  );
  if (o.kind !== 'session') throw new Error('Unexpected passkey step');
  return o;
}

/** POST /auth/passkeys/setup-options (first passkey, setup code). */
export function setupOptions(
  preAuth: string,
  setupCode: string,
): Promise<Record<string, unknown>> {
  return api.post(
    '/auth/passkeys/setup-options',
    {preAuth, setupCode},
    {auth: false},
  );
}

/** POST /auth/passkeys/setup → first passkey + admin session. */
export async function setupPasskey(
  preAuth: string,
  setupCode: string,
  credential: Record<string, unknown>,
): Promise<BrowserSession & {total: number}> {
  const raw = await api.post<RawSession & {total?: number}>(
    '/auth/passkeys/setup',
    {preAuth, setupCode, credential},
    {auth: false},
  );
  const o = toOutcome(raw);
  if (o.kind !== 'session') throw new Error('Unexpected passkey step');
  return {...o, total: raw.total ?? 1};
}

/** POST /auth/recovery → admin session (a new passkey should follow). */
export async function recoveryLogin(
  preAuth: string,
  recoveryCode: string,
): Promise<BrowserSession> {
  const o = toOutcome(
    await api.post<RawSession>(
      '/auth/recovery',
      {preAuth, recoveryCode},
      {auth: false},
    ),
  );
  if (o.kind !== 'session') throw new Error('Unexpected passkey step');
  return o;
}

/** POST /admin/passkeys/options (registration of another passkey). */
export function adminPasskeyOptions(): Promise<Record<string, unknown>> {
  return api.post('/admin/passkeys/options', undefined, {
    noActAs: true,
    idempotencyKey: idempotencyKey(),
  });
}

/** POST /admin/passkeys (step-up required) → recovery codes on the 2nd. */
export function addAdminPasskey(
  credential: Record<string, unknown>,
  stepUp: string,
  label?: string,
): Promise<{passkey: PasskeyDto; total: number; recoveryCodes?: string[]}> {
  return api.post(
    '/admin/passkeys',
    {credential, ...(label ? {label} : {})},
    {noActAs: true, stepUp, idempotencyKey: idempotencyKey()},
  );
}

/** Stores a new session (memory token, `/me` cache, admin 8 h clock). */
export function applySession(s: BrowserSession, qc?: QueryClient): void {
  const store = useSession.getState();
  store.setGrant({
    accessToken: s.accessToken,
    expiresIn: s.expiresIn,
    me: s.me,
  });
  if (s.me) qc?.setQueryData(qk.me(), s.me);
  store.setAdminSessionEndsAt(
    useSession.getState().role === 'admin'
      ? Date.now() + LIFECYCLE.adminSessionHours * 3_600_000
      : undefined,
  );
}

/** DELETE /auth/sessions/current. */
export function logout(): Promise<void> {
  return api.del<void>('/auth/sessions/current', undefined, {noActAs: true});
}

/** PATCH /me (language, time zone). */
export function patchMe(patch: {
  locale?: Locale;
  timeZone?: string;
}): Promise<Me> {
  return api.patch<Me>('/me', patch, {noActAs: true});
}

/** POST /me/codes (purpose terminate; signed in). */
export function sendTerminateCode(): Promise<void> {
  return api.post<void>('/me/codes', {purpose: 'terminate'}, {noActAs: true});
}

/** POST /me/trial/termination with the e-mailed code → 202. */
export function terminateTrial(code: string): Promise<void> {
  return api.post<void>('/me/trial/termination', {code}, {noActAs: true});
}

/**
 * GET /me/export: reads the `application/jsonl` stream chunk by chunk into
 * a Blob (the only in-app export). `onProgress` receives bytes read.
 */
export async function exportWorkspace(
  onProgress?: (bytes: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const res = await apiRaw('/me/export', {
    headers: {accept: 'application/jsonl'},
    signal,
  });
  const parts: BlobPart[] = [];
  let bytes = 0;
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    onProgress?.(text.length);
    return new Blob([text], {type: 'application/jsonl'});
  }
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    if (value) {
      parts.push(value as BlobPart);
      bytes += value.byteLength;
      onProgress?.(bytes);
    }
  }
  return new Blob(parts, {type: 'application/jsonl'});
}

/** GET /archive-deletions/{token} (public; token is the credential). */
export function getArchiveDeletion(
  token: string,
): Promise<ArchiveDeletionInfo> {
  return api.get<ArchiveDeletionInfo>(
    `/archive-deletions/${encodeURIComponent(token)}`,
    {auth: false},
  );
}

/** POST /archive-deletions/{token} → 204. */
export function deleteArchive(token: string, key: string): Promise<void> {
  return api.post<void>(
    `/archive-deletions/${encodeURIComponent(token)}`,
    undefined,
    {auth: false, idempotencyKey: key},
  );
}
