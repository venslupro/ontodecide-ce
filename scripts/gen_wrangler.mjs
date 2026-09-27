#!/usr/bin/env node
/**
 * @fileoverview Renders apps/<worker>/wrangler.jsonc from wrangler.jsonc.tpl.
 *
 * Resource ids come from `terraform output -json` (never hand-written).
 *
 * Usage:
 *   node scripts/gen_wrangler.mjs --env prod|local [--tf-output out.json]
 *       [--allow-missing]
 *
 * prod: values from Terraform outputs plus the environment:
 *   JWT_SIGNING_KEY [+ JWT_SIGNING_KEY_PREV]  → api-gateway JWT_PUBLIC_KEYS
 *                                              (public parts only)
 *   CLOUDFLARE_ACCOUNT_ID | CF_ACCOUNT_ID     → CF_ACCOUNT_ID
 *   MAIL_FROM (default noreply@mail.<domain>) → MAIL_FROM
 *   EMAIL_MODE (default live)                 → EMAIL_MODE
 *   APP_VERSION (default git short sha)
 * The api-gateway route `<app host>/api/*` is rendered only when Terraform
 * reports a domain; otherwise `routes` is removed (Pages Functions proxy).
 *
 * local (`wrangler dev`, no login): placeholder ids, EMAIL_MODE=log, no
 * Workers AI binding, no routes, APP_ORIGIN http://localhost:5173, and
 * stable dev secrets generated once into .wrangler/dev-secrets.json (put
 * into identity-access `vars`). Turnstile uses Cloudflare's always-pass
 * test secret.
 *
 * --allow-missing (pull-request builds only) renders a `pending-…`
 * placeholder, with a warning, for an output or value whose resource is
 * added by the change but not applied yet. Deploys never pass it.
 *
 * Every resource is named {project}-{env}-{service|module} (`${PREFIX}-…` in
 * the templates), e.g. ontodecide-prd-api-gateway. The prod prefix must match
 * Terraform's `name_prefix` output.
 */

import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  newSigningJwk,
  publicJwkSet,
  randomSecret,
  setupCode,
} from './gen_secrets.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Project segment of every resource name. */
export const PROJECT = 'ontodecide';

/** --env value → environment segment of resource names. */
export const ENV_CODES = {prod: 'prd', local: 'local'};

/** Pages host, the app location while no domain is configured. */
export const PAGES_HOST = 'ontodecide-ce.pages.dev';

/** Local web origin (Vite dev server, proxies /api to the gateway). */
export const LOCAL_ORIGIN = 'http://localhost:5173';

/** Cloudflare Turnstile test secret that always passes. */
export const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';

/** Dev secrets file (gitignored with .wrangler/). */
export const DEV_SECRETS_FILE = join(ROOT, '.wrangler', 'dev-secrets.json');

/** `{project}-{env}` prefix of every resource name. */
export function namePrefix(env) {
  return `${PROJECT}-${ENV_CODES[env]}`;
}

/** Workers in deployment order (leaf → root, see deploy.yml). */
export const WORKERS = [
  'ontology-manager',
  'object-graph',
  'situation-awareness',
  'decision-engine',
  'data-integration',
  'identity-access',
  'api-gateway',
];

/** D1 template key → service owning the database. */
export const D1_KEYS = {
  IDENTITY: 'identity-access',
  ONTOLOGY: 'ontology-manager',
  INTEGRATION: 'data-integration',
  OBJECT: 'object-graph',
  DECISION: 'decision-engine',
};

/** Workers whose local dev secrets are injected as vars. */
const LOCAL_SECRET_WORKERS = ['identity-access'];

function parseArgs(argv) {
  const args = {env: 'local', tfOutput: undefined, allowMissing: false};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--env') args.env = argv[++i];
    else if (argv[i] === '--tf-output') args.tfOutput = argv[++i];
    else if (argv[i] === '--allow-missing') args.allowMissing = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!Object.hasOwn(ENV_CODES, args.env)) {
    throw new Error(`Unknown env: ${args.env}`);
  }
  return args;
}

function gitVersion() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {cwd: ROOT})
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
}

function readTfOutputs(file) {
  const raw = file
    ? readFileSync(file, 'utf8')
    : execFileSync('terraform', ['-chdir=infra', 'output', '-json'], {
        cwd: ROOT,
      }).toString();
  const out = JSON.parse(raw);
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.value]));
}

/**
 * Returns a value, or a placeholder when it is missing and `allowMissing`
 * is set; throws otherwise.
 */
function required(value, label, allowMissing) {
  if (value !== undefined && value !== null && value !== '') return value;
  if (!allowMissing) throw new Error(`${label} is missing`);
  console.warn(`::warning::${label} is missing (not applied / set yet)`);
  return `pending-${label.replace(/[^A-Za-z0-9-]+/g, '-')}`;
}

/**
 * Loads the local dev secrets, generating them on first use so tokens and
 * stored hashes stay valid across `pnpm dev` restarts.
 */
export function loadDevSecrets(file = DEV_SECRETS_FILE) {
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const secrets = {
    JWT_SIGNING_KEY: JSON.stringify(newSigningJwk('local-1')),
    EMAIL_PEPPER: randomSecret(),
    EMAIL_ENC_KEY: randomSecret(),
    BOOTSTRAP_ADMIN_EMAIL: 'admin@ontodecide.local',
    BOOTSTRAP_ADMIN_SETUP_CODE: setupCode(),
    TURNSTILE_SECRET: TURNSTILE_TEST_SECRET,
  };
  mkdirSync(dirname(file), {recursive: true});
  writeFileSync(file, JSON.stringify(secrets, null, 2) + '\n', {mode: 0o600});
  console.log(`generated ${file}`);
  return secrets;
}

/**
 * Builds the substitution map for an environment.
 * @param {'prod'|'local'} env
 * @param {Record<string, any>} tf Terraform output values (prod).
 * @param {{allowMissing?: boolean, environ?: Record<string, string|undefined>,
 *     devSecrets?: Record<string, string>}} [opts]
 */
export function buildVars(env, tf, opts = {}) {
  const {allowMissing = false, environ = process.env} = opts;
  const prefix = namePrefix(env);
  if (env !== 'local') {
    const tfPrefix = required(tf.name_prefix, 'name_prefix', allowMissing);
    if (!tfPrefix.startsWith('pending-') && tfPrefix !== prefix) {
      throw new Error(
        `Terraform name_prefix ${tfPrefix} does not match ${prefix}`,
      );
    }
  }
  const vars = {
    PREFIX: prefix,
    ENVIRONMENT: env,
    APP_VERSION: environ.APP_VERSION || gitVersion(),
  };

  for (const [key, service] of Object.entries(D1_KEYS)) {
    const name = `${prefix}-${service}-db`;
    if (env === 'local') {
      vars[`D1_${key}_NAME`] = name;
      vars[`D1_${key}_ID`] = `local-${service}-db`;
    } else {
      const db = tf.d1?.[`${service}-db`];
      vars[`D1_${key}_NAME`] = db?.name ?? name;
      vars[`D1_${key}_ID`] = required(
        db?.id,
        `d1["${service}-db"].id`,
        allowMissing,
      );
    }
  }

  if (env === 'local') {
    const secrets = opts.devSecrets ?? loadDevSecrets();
    Object.assign(vars, {
      QUEUE_DOMAIN_EVENTS: `${prefix}-domain-events`,
      QUEUE_DEAD_LETTER: `${prefix}-dead-letter`,
      B2_ARCHIVE_BUCKET: `${prefix}-archive`,
      B2_REGION: 'us-east-005',
      B2_ENDPOINT: 's3.us-east-005.backblazeb2.com',
      APP_DOMAIN: '',
      APP_HOST: 'localhost:5173',
      APP_ORIGIN: LOCAL_ORIGIN,
      ZONE_NAME: '',
      WEBAUTHN_RP_ID: 'localhost',
      JWT_PUBLIC_KEYS: JSON.stringify(publicJwkSet([secrets.JWT_SIGNING_KEY])),
      CF_ACCOUNT_ID: 'local',
      MAIL_FROM: 'OntoDecide CE <noreply@ontodecide.local>',
      EMAIL_MODE: 'log',
    });
    return vars;
  }

  const domain = tf.app?.domain ?? '';
  let host = tf.app?.host;
  if (!host) {
    required(undefined, 'app.host', allowMissing);
    host = domain ? `app.${domain}` : PAGES_HOST;
  }
  const emailMode = environ.EMAIL_MODE || 'live';
  if (!['live', 'log'].includes(emailMode)) {
    throw new Error(`EMAIL_MODE must be live or log, got ${emailMode}`);
  }
  const signingKeys = [environ.JWT_SIGNING_KEY, environ.JWT_SIGNING_KEY_PREV];
  let jwks;
  if (environ.JWT_SIGNING_KEY) {
    jwks = JSON.stringify(publicJwkSet(signingKeys));
  } else {
    required(undefined, 'env JWT_SIGNING_KEY', allowMissing);
    jwks = JSON.stringify({keys: []});
  }
  Object.assign(vars, {
    QUEUE_DOMAIN_EVENTS: required(
      tf.queues?.domain_events,
      'queues.domain_events',
      allowMissing,
    ),
    QUEUE_DEAD_LETTER: required(
      tf.queues?.dead_letter,
      'queues.dead_letter',
      allowMissing,
    ),
    B2_ARCHIVE_BUCKET: required(tf.b2?.bucket, 'b2.bucket', allowMissing),
    B2_REGION: required(tf.b2?.region, 'b2.region', allowMissing),
    B2_ENDPOINT: required(tf.b2?.endpoint, 'b2.endpoint', allowMissing),
    APP_DOMAIN: domain,
    APP_HOST: host,
    APP_ORIGIN: tf.app?.origin ?? `https://${host}`,
    ZONE_NAME: domain,
    WEBAUTHN_RP_ID: host,
    JWT_PUBLIC_KEYS: jwks,
    CF_ACCOUNT_ID: required(
      environ.CLOUDFLARE_ACCOUNT_ID || environ.CF_ACCOUNT_ID,
      'env CLOUDFLARE_ACCOUNT_ID',
      allowMissing,
    ),
    MAIL_FROM:
      environ.MAIL_FROM ||
      (domain ? `OntoDecide CE <noreply@mail.${domain}>` : ''),
    EMAIL_MODE: emailMode,
  });
  if (emailMode === 'live' && !vars.MAIL_FROM) {
    required(undefined, 'env MAIL_FROM', allowMissing);
  }
  return vars;
}

/** Strips // line comments that are not inside strings. */
export function stripJsonComments(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else {
      out += c;
    }
  }
  return out;
}

/**
 * Renders one template into a config object. Placeholders sit inside JSON
 * strings, so values are JSON-escaped.
 * @param {string} template
 * @param {Record<string, string>} vars
 * @param {'prod'|'local'} env
 * @param {Record<string, string>} [devSecrets] local only.
 */
export function render(template, vars, env, devSecrets = {}) {
  const text = stripJsonComments(template).replace(
    /\$\{([A-Z0-9_]+)\}/g,
    (_, name) => {
      if (!(name in vars)) {
        throw new Error(`Unresolved template variable \${${name}}`);
      }
      return JSON.stringify(String(vars[name])).slice(1, -1);
    },
  );
  const config = JSON.parse(text);
  // Only the gateway has a route, and only on a configured zone.
  if (!vars.ZONE_NAME) delete config.routes;
  if (env === 'local') {
    delete config.ai;
    if (LOCAL_SECRET_WORKERS.some(w => config.name === `${vars.PREFIX}-${w}`)) {
      config.vars = {...(config.vars ?? {}), ...devSecrets};
    }
  }
  return config;
}

/**
 * Renders every Worker config.
 * @return {Record<string, object>} worker → config.
 */
export function renderAll(env, vars, devSecrets, root = ROOT) {
  const out = {};
  for (const worker of WORKERS) {
    const tpl = join(root, 'apps', worker, 'wrangler.jsonc.tpl');
    if (!existsSync(tpl)) throw new Error(`Missing ${tpl}`);
    out[worker] = render(readFileSync(tpl, 'utf8'), vars, env, devSecrets);
  }
  return out;
}

function main() {
  const {env, tfOutput, allowMissing} = parseArgs(process.argv.slice(2));
  const tf = env === 'local' ? {} : readTfOutputs(tfOutput);
  const devSecrets = env === 'local' ? loadDevSecrets() : {};
  const vars = buildVars(env, tf, {allowMissing, devSecrets});
  const configs = renderAll(env, vars, devSecrets);
  for (const [worker, config] of Object.entries(configs)) {
    const header = `// Generated by scripts/gen_wrangler.mjs --env ${env}. Do not edit.\n`;
    writeFileSync(
      join(ROOT, 'apps', worker, 'wrangler.jsonc'),
      header + JSON.stringify(config, null, 2) + '\n',
    );
    console.log(`rendered apps/${worker}/wrangler.jsonc (${config.name})`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
