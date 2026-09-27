/**
 * @fileoverview MSW handlers for platform endpoints: /auth, /me,
 * /archive-deletions, /admin, stream tickets (owned by the platform/shell
 * code). State lives in {@link platformDb}; every request is recorded in
 * `platformDb.requests` so tests can assert headers (Idempotency-Key,
 * X-Step-Up, If-Match, X-Act-As-Tenant).
 */

import {http, HttpResponse, type HttpHandler} from 'msw';
import type {Me} from '../../entities/session/store';
import {
  adminMe,
  adminToken,
  adminUsers,
  archives,
  auditRows,
  overview,
  ownerMe,
  ownerToken,
  passkeys,
  settings,
} from '../fixtures/platform';
import {businessDb} from './business';
import {API, problem} from './problem';

/** A recorded request. */
export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

/** The valid e-mail code in tests. */
export const TEST_CODE = '123456';
/** The admin e-mail. */
export const ADMIN_EMAIL = 'admin@example.com';
/** A valid archive deletion token. */
export const VALID_DELETION_TOKEN = 'tok-valid-0123456789';
/** The valid setup code. */
export const SETUP_CODE = 'SETUP-CODE-1234';

interface PlatformDb {
  me: Me;
  role: 'owner' | 'admin';
  /** Outcome of POST /auth/sessions/refresh. */
  refresh: 'ok' | 'expired' | 'unauthenticated';
  refreshCount: number;
  signupClosed: boolean;
  codeAttemptsLeft: number;
  setupRequired: boolean;
  adminPasskeys: number;
  terminated: boolean;
  archiveDeleted: boolean;
  settingsVersion: number;
  blocked: string[];
  requests: RecordedRequest[];
  tokenSeq: number;
}

function fresh(): PlatformDb {
  return {
    me: ownerMe(),
    role: 'owner',
    refresh: 'ok',
    refreshCount: 0,
    signupClosed: false,
    codeAttemptsLeft: 4,
    setupRequired: false,
    adminPasskeys: 2,
    terminated: false,
    archiveDeleted: false,
    settingsVersion: settings().version,
    blocked: ['mailinator.com'],
    requests: [],
    tokenSeq: 0,
  };
}

/** Mutable platform state (reset after each test). */
export const platformDb: PlatformDb = fresh();

/** Resets the platform in-memory state between tests. */
export function resetPlatformDb(): void {
  Object.assign(platformDb, fresh());
}

/** Requests matching method and path prefix. */
export function recorded(
  method: string,
  pathPrefix: string,
): RecordedRequest[] {
  return platformDb.requests.filter(
    r => r.method === method && r.path.startsWith(pathPrefix),
  );
}

async function record(request: Request): Promise<RecordedRequest> {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    headers[k] = v;
  });
  let body: unknown;
  try {
    const text = await request.clone().text();
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  const r = {
    method: request.method,
    path: url.pathname.replace(/^\/api\/v1/, '') + url.search,
    headers,
    body,
  };
  platformDb.requests.push(r);
  return r;
}

function token(): string {
  platformDb.tokenSeq += 1;
  return platformDb.role === 'admin'
    ? adminToken(platformDb.tokenSeq)
    : ownerToken(platformDb.tokenSeq);
}

function session(status = 201) {
  return HttpResponse.json(
    {accessToken: token(), expiresIn: 900, me: platformDb.me},
    {status},
  );
}

const OPTIONS = {
  challenge: 'Y2hhbGxlbmdl',
  rpId: 'localhost',
  userVerification: 'required',
  allowCredentials: [{id: 'Y3JlZDE', type: 'public-key'}],
};

const CREATE_OPTIONS = {
  challenge: 'Y2hhbGxlbmdl',
  rp: {id: 'localhost', name: 'OntoDecide'},
  user: {id: 'dXNlcg', name: ADMIN_EMAIL, displayName: 'Admin'},
  pubKeyCredParams: [{type: 'public-key', alg: -8}],
  authenticatorSelection: {userVerification: 'required'},
};

function needIdem(r: RecordedRequest) {
  return r.headers['idempotency-key']
    ? null
    : problem(400, 'VALIDATION_FAILED', 'Idempotency-Key required');
}

function needStepUp(r: RecordedRequest) {
  return r.headers['x-step-up'] === 'su-1'
    ? null
    : problem(403, 'FORBIDDEN', 'step-up required');
}

function needAdmin(r: RecordedRequest) {
  if (platformDb.role !== 'admin') return problem(403, 'FORBIDDEN');
  if (r.headers['x-act-as-tenant'])
    return problem(403, 'FORBIDDEN', 'no act-as on /admin');
  return null;
}

/** Platform handlers. */
export const platformHandlers: HttpHandler[] = [
  // —— auth ——
  http.post(`${API}/auth/codes`, async ({request}) => {
    await record(request);
    if (platformDb.signupClosed) return problem(503, 'SIGNUP_CLOSED');
    return new HttpResponse(null, {status: 202});
  }),
  http.post(`${API}/auth/sessions/refresh`, async ({request}) => {
    await record(request);
    platformDb.refreshCount += 1;
    if (platformDb.refresh === 'expired') return problem(401, 'TRIAL_EXPIRED');
    if (platformDb.refresh === 'unauthenticated')
      return problem(401, 'UNAUTHENTICATED');
    return HttpResponse.json({accessToken: token(), expiresIn: 900});
  }),
  http.post(`${API}/auth/sessions`, async ({request}) => {
    const r = await record(request);
    const b = r.body as {email: string; code: string};
    if (b.code !== TEST_CODE) {
      platformDb.codeAttemptsLeft = Math.max(
        0,
        platformDb.codeAttemptsLeft - 1,
      );
      return problem(400, 'CODE_INVALID', undefined, {
        left: platformDb.codeAttemptsLeft,
      });
    }
    if (b.email === ADMIN_EMAIL) {
      platformDb.role = 'admin';
      platformDb.me = adminMe(platformDb.adminPasskeys);
      return HttpResponse.json({
        passkeyRequired: true,
        preAuth: 'pre-1',
        setupRequired: platformDb.setupRequired,
      });
    }
    platformDb.role = 'owner';
    platformDb.me = {...ownerMe(72), email: b.email};
    return session();
  }),
  http.delete(`${API}/auth/sessions/current`, async ({request}) => {
    await record(request);
    return new HttpResponse(null, {status: 204});
  }),
  http.post(`${API}/auth/passkeys/options`, async ({request}) => {
    await record(request);
    return HttpResponse.json(OPTIONS);
  }),
  http.post(`${API}/auth/passkeys/assertion`, async ({request}) => {
    const r = await record(request);
    const b = r.body as {purpose: string; credential?: {id?: string}};
    if (!b.credential?.id) return problem(401, 'UNAUTHENTICATED');
    if (b.purpose === 'step_up')
      return HttpResponse.json({stepUpToken: 'su-1', expiresIn: 300});
    return session();
  }),
  http.post(`${API}/auth/passkeys/setup-options`, async ({request}) => {
    const r = await record(request);
    const b = r.body as {setupCode: string};
    if (b.setupCode !== SETUP_CODE) return problem(403, 'FORBIDDEN');
    return HttpResponse.json(CREATE_OPTIONS);
  }),
  http.post(`${API}/auth/passkeys/setup`, async ({request}) => {
    await record(request);
    platformDb.adminPasskeys = 1;
    platformDb.setupRequired = false;
    platformDb.me = adminMe(1);
    return HttpResponse.json(
      {
        passkey: {
          id: 'pk1',
          label: null,
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
        },
        total: 1,
        accessToken: token(),
        expiresIn: 900,
        me: platformDb.me,
      },
      {status: 201},
    );
  }),
  http.post(`${API}/auth/recovery`, async ({request}) => {
    const r = await record(request);
    const b = r.body as {recoveryCode: string};
    if (b.recoveryCode !== 'RECOVERY-0001') return problem(400, 'CODE_INVALID');
    return session();
  }),
  // —— me ——
  http.get(`${API}/me`, async ({request}) => {
    await record(request);
    if (!request.headers.get('authorization'))
      return problem(401, 'UNAUTHENTICATED');
    // Quotas come from the business db so quota tests can change them.
    return HttpResponse.json(
      {...platformDb.me, quotas: businessDb.quotas ?? platformDb.me.quotas},
      {headers: {date: new Date().toUTCString()}},
    );
  }),
  http.patch(`${API}/me`, async ({request}) => {
    const r = await record(request);
    platformDb.me = {...platformDb.me, ...(r.body as Partial<Me>)};
    return HttpResponse.json(platformDb.me);
  }),
  http.post(`${API}/me/codes`, async ({request}) => {
    const r = await record(request);
    if (platformDb.role === 'admin') return problem(403, 'FORBIDDEN');
    if ((r.body as {purpose?: string})?.purpose !== 'terminate')
      return problem(400, 'VALIDATION_FAILED');
    return new HttpResponse(null, {status: 202});
  }),
  http.post(`${API}/me/trial/termination`, async ({request}) => {
    const r = await record(request);
    if ((r.body as {code?: string})?.code !== TEST_CODE)
      return problem(400, 'CODE_INVALID', undefined, {left: 3});
    platformDb.terminated = true;
    return new HttpResponse(null, {status: 202});
  }),
  http.get(`${API}/me/export`, async ({request}) => {
    await record(request);
    const lines = [
      {file: 'ontology.json', data: {types: []}},
      {file: 'objects.jsonl', data: {rid: 'ri.obj.1'}},
    ]
      .map(l => JSON.stringify(l))
      .join('\n');
    return new HttpResponse(`${lines}\n`, {
      headers: {'content-type': 'application/jsonl'},
    });
  }),
  // —— archive deletion (public) ——
  http.get(`${API}/archive-deletions/:token`, async ({request, params}) => {
    await record(request);
    if (params.token !== VALID_DELETION_TOKEN || platformDb.archiveDeleted)
      return problem(404, 'NOT_FOUND');
    return HttpResponse.json({
      expiresAt: '2026-10-05T06:20:00.000Z',
      sizeBytes: 412_000,
    });
  }),
  http.post(`${API}/archive-deletions/:token`, async ({request, params}) => {
    const r = await record(request);
    if (!r.headers['idempotency-key']) return problem(400, 'VALIDATION_FAILED');
    if (params.token !== VALID_DELETION_TOKEN || platformDb.archiveDeleted)
      return problem(404, 'NOT_FOUND');
    platformDb.archiveDeleted = true;
    return new HttpResponse(null, {status: 204});
  }),
  // —— realtime ticket ——
  http.post(`${API}/situation/stream-tickets`, async ({request}) => {
    await record(request);
    return HttpResponse.json(
      {ticket: `${platformDb.me.workspace.tenantId}.rnd`, expiresIn: 30},
      {status: 201},
    );
  }),
  // —— admin ——
  http.get(`${API}/admin/overview`, async ({request}) => {
    const r = await record(request);
    return needAdmin(r) ?? HttpResponse.json(overview());
  }),
  http.get(`${API}/admin/users`, async ({request}) => {
    const r = await record(request);
    return (
      needAdmin(r) ?? HttpResponse.json({items: adminUsers(), nextCursor: null})
    );
  }),
  http.patch(`${API}/admin/users/:uid`, async ({request}) => {
    const r = await record(request);
    const bad = needAdmin(r) ?? needIdem(r) ?? needStepUp(r);
    if (bad) return bad;
    return HttpResponse.json({...adminUsers()[0], ...(r.body as object)});
  }),
  http.delete(`${API}/admin/users/:uid/sessions`, async ({request}) => {
    const r = await record(request);
    return needAdmin(r) ?? needIdem(r) ?? HttpResponse.json({revoked: 2});
  }),
  http.delete(`${API}/admin/users/:uid`, async ({request}) => {
    const r = await record(request);
    const bad = needAdmin(r) ?? needIdem(r) ?? needStepUp(r);
    if (bad) return bad;
    if (!(r.body as {reason?: string})?.reason)
      return problem(400, 'VALIDATION_FAILED');
    return new HttpResponse(null, {status: 202});
  }),
  http.get(`${API}/admin/archives`, async ({request}) => {
    const r = await record(request);
    return (
      needAdmin(r) ?? HttpResponse.json({items: archives(), nextCursor: null})
    );
  }),
  http.post(`${API}/admin/archives/:tid/download-link`, async ({request}) => {
    const r = await record(request);
    return (
      needAdmin(r) ??
      needIdem(r) ??
      HttpResponse.json({
        url: 'https://f000.backblazeb2.com/file/archive/x.zip?sig=1',
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      })
    );
  }),
  http.delete(`${API}/admin/archives/:tid`, async ({request}) => {
    const r = await record(request);
    return (
      needAdmin(r) ??
      needIdem(r) ??
      needStepUp(r) ??
      new HttpResponse(null, {status: 204})
    );
  }),
  http.get(`${API}/admin/settings`, async ({request}) => {
    const r = await record(request);
    return (
      needAdmin(r) ??
      HttpResponse.json(
        {...settings(), version: platformDb.settingsVersion},
        {headers: {etag: `"v${platformDb.settingsVersion}"`}},
      )
    );
  }),
  http.patch(`${API}/admin/settings`, async ({request}) => {
    const r = await record(request);
    const bad = needAdmin(r) ?? needIdem(r) ?? needStepUp(r);
    if (bad) return bad;
    if (r.headers['if-match'] !== `"v${platformDb.settingsVersion}"`)
      return problem(412, 'PRECONDITION_FAILED');
    platformDb.settingsVersion += 1;
    return HttpResponse.json({
      ...settings(),
      ...(r.body as object),
      version: platformDb.settingsVersion,
    });
  }),
  http.get(`${API}/admin/blocked-domains`, async ({request}) => {
    const r = await record(request);
    return needAdmin(r) ?? HttpResponse.json({domains: platformDb.blocked});
  }),
  http.put(`${API}/admin/blocked-domains`, async ({request}) => {
    const r = await record(request);
    const bad = needAdmin(r) ?? needIdem(r);
    if (bad) return bad;
    platformDb.blocked = (r.body as {domains: string[]}).domains;
    return HttpResponse.json({domains: platformDb.blocked});
  }),
  http.get(`${API}/admin/audit-log`, async ({request}) => {
    const r = await record(request);
    return (
      needAdmin(r) ??
      HttpResponse.json({items: auditRows(), nextCursor: null, chainOk: true})
    );
  }),
  http.get(`${API}/admin/passkeys`, async ({request}) => {
    const r = await record(request);
    return needAdmin(r) ?? HttpResponse.json(passkeys());
  }),
  http.post(`${API}/admin/passkeys/options`, async ({request}) => {
    const r = await record(request);
    return needAdmin(r) ?? HttpResponse.json(CREATE_OPTIONS);
  }),
  http.post(`${API}/admin/passkeys`, async ({request}) => {
    const r = await record(request);
    const bad = needAdmin(r) ?? needStepUp(r);
    if (bad) return bad;
    platformDb.adminPasskeys += 1;
    platformDb.me = adminMe(platformDb.adminPasskeys);
    return HttpResponse.json(
      {
        passkey: {
          id: `pk${platformDb.adminPasskeys}`,
          label: null,
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
        },
        total: platformDb.adminPasskeys,
        ...(platformDb.adminPasskeys === 2
          ? {
              recoveryCodes: Array.from(
                {length: 10},
                (_, i) => `RC-${String(i).padStart(4, '0')}-ABCD`,
              ),
            }
          : {}),
      },
      {status: 201},
    );
  }),
  http.delete(`${API}/admin/passkeys/:id`, async ({request}) => {
    const r = await record(request);
    return (
      needAdmin(r) ?? needStepUp(r) ?? new HttpResponse(null, {status: 204})
    );
  }),
];
