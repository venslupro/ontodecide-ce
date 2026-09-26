#!/usr/bin/env node
/**
 * @fileoverview Renders apps/<worker>/wrangler.jsonc from wrangler.jsonc.tpl.
 *
 * Resource ids come from `terraform output -json` (never hand-written). For
 * local development (`--env local`) placeholder ids are used, remote-only
 * bindings (Workers AI, Vectorize) are dropped and dev-only secrets are put
 * into `vars` so `wrangler dev` needs no login.
 *
 * Usage:
 *   node scripts/gen_wrangler.mjs --env prod|local [--tf-output out.json]
 *       [--allow-missing]
 *
 * --allow-missing (pull-request builds only) renders a `pending-…`
 * placeholder, with a warning, for an output whose resource is added by the
 * change but not applied yet. Deploys never pass it.
 *
 * There is a single deployed environment (production, from main); `local`
 * only renders configs for `wrangler dev` on a developer machine.
 */

import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Workers in deployment order (leaf → root). */
export const WORKERS = [
  'ontology-manager',
  'data-integration',
  'object-graph',
  'situation-awareness',
  'decision-engine',
  'identity-access',
  'api-gateway',
];

/** D1 template key → service owning the database. */
const D1_KEYS = {
  IDENTITY: 'identity-access',
  ONTOLOGY: 'ontology-manager',
  INTEGRATION: 'data-integration',
  OBJECT: 'object-graph',
  SITUATION: 'situation-awareness',
  DECISION: 'decision-engine',
};

/** Dev-only secrets injected as vars for `--env local`. */
export const LOCAL_SECRETS = {
  JWT_SECRET: 'k1:local-dev-jwt-secret-change-me-0123456789',
  APPROVAL_SECRET: 'local-dev-approval-secret',
  WRITEBACK_SECRET: 'local-dev-writeback-secret',
  CONNECTOR_ENC_KEY: 'local-dev-connector-key',
  BOOTSTRAP_ADMIN_PASSWORD: 'Admin12345!',
};

function parseArgs(argv) {
  const args = {env: 'local', tfOutput: undefined, allowMissing: false};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--env') args.env = argv[++i];
    else if (argv[i] === '--tf-output') args.tfOutput = argv[++i];
    else if (argv[i] === '--allow-missing') args.allowMissing = true;
  }
  if (!['prod', 'local'].includes(args.env)) {
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
 * Returns a Terraform output value, or a placeholder when it is missing and
 * `allowMissing` is set.
 */
function tfValue(value, label, allowMissing) {
  if (value !== undefined && value !== null) return value;
  if (!allowMissing) throw new Error(`Terraform output ${label} is missing`);
  console.warn(
    `::warning::Terraform output ${label} is missing (not applied yet)`,
  );
  return `pending-${label.replace(/[^A-Za-z0-9-]+/g, '-')}`;
}

/** Builds the substitution map for an environment. */
export function buildVars(env, tf, allowMissing = false) {
  const vars = {
    ENVIRONMENT: env,
    APP_VERSION: process.env.APP_VERSION ?? gitVersion(),
    COOKIE_SECURE: env === 'local' ? 'false' : 'true',
    BOOTSTRAP_ADMIN_EMAIL:
      process.env.BOOTSTRAP_ADMIN_EMAIL ?? 'admin@ontodecide.local',
    FEATURE_NEO4J: 'false',
  };
  for (const [key, service] of Object.entries(D1_KEYS)) {
    if (env === 'local') {
      vars[`D1_${key}_NAME`] = `${service}-db`;
      vars[`D1_${key}_ID`] = `local-${service}-db`;
    } else {
      const name = `${service}-db`;
      const db = tf.d1?.[name];
      if (!db) tfValue(undefined, `d1["${name}"]`, allowMissing);
      vars[`D1_${key}_NAME`] = db?.name ?? name;
      vars[`D1_${key}_ID`] = db?.id ?? `pending-${name}`;
    }
  }
  if (env === 'local') {
    Object.assign(vars, {
      KV_SCHEMA_CACHE_ID: 'local-schema-cache',
      KV_GATEWAY_CONFIG_ID: 'local-gateway-config',
      B2_RAW_BUCKET: 'ontodecide-ce-raw-local',
      B2_REGION: 'us-east-005',
      B2_ENDPOINT: 's3.us-east-005.backblazeb2.com',
    });
  } else {
    Object.assign(vars, {
      KV_SCHEMA_CACHE_ID: tfValue(
        tf.kv?.schema_cache,
        'kv.schema_cache',
        allowMissing,
      ),
      KV_GATEWAY_CONFIG_ID: tfValue(
        tf.kv?.gateway_config,
        'kv.gateway_config',
        allowMissing,
      ),
      B2_RAW_BUCKET: tfValue(tf.b2?.bucket, 'b2.bucket', allowMissing),
      B2_REGION: tfValue(tf.b2?.region, 'b2.region', allowMissing),
      B2_ENDPOINT: tfValue(tf.b2?.endpoint, 'b2.endpoint', allowMissing),
      FEATURE_NEO4J: tf.neo4j ? 'true' : 'false',
    });
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

/** Renders one template into a config object. */
export function render(template, vars, env) {
  const text = stripJsonComments(template).replace(
    /\$\{([A-Z0-9_]+)\}/g,
    (_, name) => {
      if (!(name in vars))
        throw new Error(`Unresolved template variable \${${name}}`);
      return vars[name];
    },
  );
  const config = JSON.parse(text);
  if (env === 'local') {
    delete config.ai;
    delete config.vectorize;
    config.vars = {...(config.vars ?? {}), ...LOCAL_SECRETS};
    // Local cron triggers are exercised through /__scheduled instead.
  }
  return config;
}

function main() {
  const {env, tfOutput, allowMissing} = parseArgs(process.argv.slice(2));
  const tf = env === 'local' ? {} : readTfOutputs(tfOutput);
  const vars = buildVars(env, tf, allowMissing);
  for (const worker of WORKERS) {
    const tpl = join(ROOT, 'apps', worker, 'wrangler.jsonc.tpl');
    if (!existsSync(tpl)) throw new Error(`Missing ${tpl}`);
    const config = render(readFileSync(tpl, 'utf8'), vars, env);
    const header = `// Generated by scripts/gen_wrangler.mjs --env ${env}. Do not edit.\n`;
    writeFileSync(
      join(ROOT, 'apps', worker, 'wrangler.jsonc'),
      header + JSON.stringify(config, null, 2) + '\n',
    );
    console.log(`rendered apps/${worker}/wrangler.jsonc (${config.name})`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
