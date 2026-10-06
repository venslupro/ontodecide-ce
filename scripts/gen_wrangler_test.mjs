/**
 * @fileoverview Self-checks for gen_wrangler.mjs / gen_secrets.mjs
 * (`node --test scripts/`; not part of the vitest projects).
 */

import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';

import {
  TURNSTILE_TEST_SECRET,
  buildVars,
  loadDevSecrets,
  renderAll,
} from './gen_wrangler.mjs';
import {newSigningJwk, publicJwkSet, setupCode} from './gen_secrets.mjs';

const TF = {
  name_prefix: 'ontodecide-prd',
  d1: Object.fromEntries(
    [
      'identity-access',
      'ontology-manager',
      'data-integration',
      'object-graph',
      'decision-engine',
    ].map(s => [`${s}-db`, {id: `id-${s}`, name: `ontodecide-prd-${s}-db`}]),
  ),
  queues: {
    domain_events: 'ontodecide-prd-domain-events',
    dead_letter: 'ontodecide-prd-dead-letter',
  },
  b2: {
    bucket: 'ontodecide-prd-archive',
    region: 'us-east-005',
    endpoint: 's3.us-east-005.backblazeb2.com',
  },
  app: {
    domain: 'example.com',
    host: 'ontodecide-ce.example.com',
    origin: 'https://ontodecide-ce.example.com',
  },
};

const KEY = JSON.stringify(newSigningJwk('2026-09'));
const PREV = JSON.stringify(newSigningJwk('2026-08'));
const ENVIRON = {
  JWT_SIGNING_KEY: KEY,
  JWT_SIGNING_KEY_PREV: PREV,
  CLOUDFLARE_ACCOUNT_ID: 'acc',
  APP_VERSION: 'test',
};

test('prod with a domain drops routes (no Cloudflare zone) and keeps public keys', () => {
  const vars = buildVars('prod', TF, {environ: ENVIRON});
  const c = renderAll('prod', vars, {});
  const gw = c['api-gateway'];
  assert.equal(gw.name, 'ontodecide-prd-api-gateway');
  // No Cloudflare zone → no Workers Route; /api/* uses the Pages Functions
  // proxy instead.
  assert.equal(gw.routes, undefined);
  const jwks = JSON.parse(gw.vars.JWT_PUBLIC_KEYS);
  assert.deepEqual(
    jwks.keys.map(k => k.kid),
    ['2026-09', '2026-08'],
  );
  assert.ok(jwks.keys.every(k => !('d' in k)));
  const ia = c['identity-access'];
  assert.equal(ia.vars.WEBAUTHN_RP_ID, 'ontodecide-ce.example.com');
  assert.equal(ia.vars.MAIL_FROM, 'OntoDecide CE <noreply@mail.example.com>');
  assert.equal(ia.vars.EMAIL_MODE, 'live');
  assert.equal(ia.vars.CF_ACCOUNT_ID, 'acc');
  assert.ok(!('JWT_SIGNING_KEY' in ia.vars));
  assert.equal(ia.services.length, 5);
  assert.ok(ia.services.every(s => s.entrypoint === 'TenantLifecycle'));
  assert.ok(gw.services.every(s => s.entrypoint !== 'TenantLifecycle'));
  assert.equal(
    c['object-graph'].d1_databases[0].database_id,
    'id-object-graph',
  );
  assert.equal(
    c['situation-awareness'].queues.consumers[0].dead_letter_queue,
    'ontodecide-prd-dead-letter',
  );
  assert.ok(c['decision-engine'].ai);
  for (const cfg of Object.values(c)) {
    assert.equal(cfg.workers_dev, false);
    assert.equal(cfg.preview_urls, false);
    assert.equal(cfg.routes, undefined);
  }
});

test('prod without a domain drops routes and uses pages.dev', () => {
  const tf = {
    ...TF,
    app: {
      domain: '',
      host: 'ontodecide-ce.pages.dev',
      origin: 'https://ontodecide-ce.pages.dev',
    },
  };
  const vars = buildVars('prod', tf, {
    environ: {...ENVIRON, MAIL_FROM: 'x <a@b.c>'},
  });
  const c = renderAll('prod', vars, {});
  assert.equal(c['api-gateway'].routes, undefined);
  assert.equal(
    c['api-gateway'].vars.APP_ORIGIN,
    'https://ontodecide-ce.pages.dev',
  );
});

test('prod rejects a mismatched prefix, non-conventional names and missing ids', () => {
  assert.throws(
    () => buildVars('prod', {...TF, name_prefix: 'x-prd'}, {environ: ENVIRON}),
    /expected ontodecide-prd/,
  );
  // Names come from the convention; Terraform may only confirm them.
  assert.throws(
    () =>
      buildVars(
        'prod',
        {...TF, queues: {...TF.queues, domain_events: 'domain-events'}},
        {environ: ENVIRON},
      ),
    /expected ontodecide-prd-domain-events/,
  );
  assert.throws(
    () =>
      buildVars(
        'prod',
        {...TF, b2: {...TF.b2, bucket: 'ontodecide-ce-archive'}},
        {environ: ENVIRON},
      ),
    /expected ontodecide-prd-archive/,
  );
  const noQueues = buildVars(
    'prod',
    {...TF, queues: undefined},
    {environ: ENVIRON},
  );
  assert.equal(noQueues.QUEUE_DOMAIN_EVENTS, 'ontodecide-prd-domain-events');
  assert.throws(
    () => buildVars('prod', TF, {environ: {CLOUDFLARE_ACCOUNT_ID: 'a'}}),
    /JWT_SIGNING_KEY/,
  );
  assert.throws(
    () => buildVars('prod', {...TF, d1: undefined}, {environ: ENVIRON}),
    /D1 ontodecide-prd-identity-access-db is missing/,
  );
});

test('an empty production state renders conventional names and one warning', () => {
  const warnings = [];
  const warn = console.warn;
  console.warn = m => warnings.push(m);
  let vars;
  try {
    vars = buildVars('prod', {}, {allowMissing: true, environ: {}});
  } finally {
    console.warn = warn;
  }
  assert.match(vars.D1_IDENTITY_ID, /^pending-/);
  assert.equal(vars.D1_IDENTITY_NAME, 'ontodecide-prd-identity-access-db');
  assert.equal(vars.QUEUE_DEAD_LETTER, 'ontodecide-prd-dead-letter');
  assert.equal(vars.B2_ARCHIVE_BUCKET, 'ontodecide-prd-archive');
  const tfWarnings = warnings.filter(w => w.includes('Terraform not applied'));
  assert.equal(tfWarnings.length, 1);
  assert.match(tfWarnings[0], /D1 ontodecide-prd-object-graph-db/);
  // Every rendered resource name follows {project}-{env}-{service|module}.
  for (const [k, v] of Object.entries(vars)) {
    if (/^D1_.*_NAME$|_BUCKET$|^QUEUE_/.test(k)) {
      assert.match(v, /^ontodecide-prd-[a-z0-9-]+$/, k);
    }
  }
});

test('local uses dev secrets, log mode, no AI and no routes', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'odgw-')), 'dev.json');
  const secrets = loadDevSecrets(file);
  assert.deepEqual(loadDevSecrets(file), secrets, 'stable across runs');
  assert.equal(secrets.TURNSTILE_SECRET, TURNSTILE_TEST_SECRET);
  const vars = buildVars('local', {}, {devSecrets: secrets});
  const c = renderAll('local', vars, secrets);
  assert.equal(c['identity-access'].vars.EMAIL_MODE, 'log');
  assert.equal(
    c['identity-access'].vars.JWT_SIGNING_KEY,
    secrets.JWT_SIGNING_KEY,
  );
  assert.equal(c['api-gateway'].vars.JWT_SIGNING_KEY, undefined);
  assert.equal(c['api-gateway'].vars.APP_ORIGIN, 'http://localhost:5173');
  assert.equal(c['api-gateway'].routes, undefined);
  assert.equal(c['decision-engine'].ai, undefined);
  assert.equal(c['data-integration'].ai, undefined);
});

/**
 * Service-binding graph of rendered configs: worker name → bound worker
 * names (ARCHITECTURE.md 2.2 requires a DAG).
 * @param {Record<string, {name: string, services?: {service: string}[]}>} c
 */
function bindingGraph(c) {
  const names = new Set(Object.values(c).map(cfg => cfg.name));
  const graph = new Map();
  for (const cfg of Object.values(c)) {
    const deps = (cfg.services ?? []).map(s => s.service);
    for (const d of deps) {
      assert.ok(names.has(d), `${cfg.name} binds unknown service ${d}`);
    }
    graph.set(cfg.name, [...new Set(deps)]);
  }
  return graph;
}

/** A cycle in the graph as a node path, or null. */
function findCycle(graph) {
  const state = new Map(); // 1 = on stack, 2 = done
  const stack = [];
  const visit = n => {
    if (state.get(n) === 2) return null;
    if (state.get(n) === 1) return [...stack.slice(stack.indexOf(n)), n];
    state.set(n, 1);
    stack.push(n);
    for (const d of graph.get(n) ?? []) {
      const c = visit(d);
      if (c) return c;
    }
    stack.pop();
    state.set(n, 2);
    return null;
  };
  for (const n of graph.keys()) {
    const c = visit(n);
    if (c) return c;
  }
  return null;
}

test('service bindings form a DAG; the gateway binds no TenantLifecycle', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'odgw-')), 'dev.json');
  const secrets = loadDevSecrets(file);
  const rendered = {
    prod: renderAll('prod', buildVars('prod', TF, {environ: ENVIRON}), {}),
    local: renderAll(
      'local',
      buildVars('local', {}, {devSecrets: secrets}),
      secrets,
    ),
  };
  for (const [env, c] of Object.entries(rendered)) {
    assert.equal(Object.keys(c).length, 7, env);
    const graph = bindingGraph(c);
    assert.equal(findCycle(graph), null, `${env}: service-binding cycle`);
    const gw = c['api-gateway'];
    assert.ok(gw.services.length > 0);
    assert.deepEqual(
      gw.services.filter(s => s.entrypoint === 'TenantLifecycle'),
      [],
      `${env}: the gateway must not bind TenantLifecycle`,
    );
    // Only identity-access drives the lifecycle of the other services.
    for (const [w, cfg] of Object.entries(c)) {
      if (w === 'identity-access') continue;
      assert.ok(
        (cfg.services ?? []).every(s => s.entrypoint !== 'TenantLifecycle'),
        `${env}: ${w} binds a TenantLifecycle entry point`,
      );
    }
    // Nothing binds the gateway (it is the edge).
    for (const deps of graph.values()) assert.ok(!deps.includes(gw.name));
  }
  // The detector itself finds cycles.
  assert.deepEqual(
    findCycle(
      new Map([
        ['a', ['b']],
        ['b', ['c']],
        ['c', ['a']],
      ]),
    ),
    ['a', 'b', 'c', 'a'],
  );
});

test('secret helpers', () => {
  assert.match(
    setupCode(),
    /^([0-9A-HJKMNP-TV-Z]{4}-){3}[0-9A-HJKMNP-TV-Z]{4}$/,
  );
  assert.throws(() => publicJwkSet([KEY, KEY]), /Duplicate/);
  assert.throws(() => publicJwkSet(['{}']), /Ed25519/);
});
