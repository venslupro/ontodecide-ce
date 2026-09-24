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
 *   node scripts/gen_wrangler.mjs --env prod|staging|local [--tf-output out.json]
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
  const args = {env: 'local', tfOutput: undefined};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--env') args.env = argv[++i];
    else if (argv[i] === '--tf-output') args.tfOutput = argv[++i];
  }
  if (!['prod', 'staging', 'local'].includes(args.env)) {
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

/** Builds the substitution map for an environment. */
export function buildVars(env, tf) {
  const vars = {
    ENV_SUFFIX: env === 'staging' ? '-staging' : '',
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
      const name = env === 'prod' ? `${service}-db` : 'staging-shared-db';
      const db = tf.d1?.[name];
      if (!db) throw new Error(`Terraform output d1["${name}"] is missing`);
      vars[`D1_${key}_NAME`] = db.name;
      vars[`D1_${key}_ID`] = db.id;
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
      KV_SCHEMA_CACHE_ID: tf.kv.schema_cache,
      KV_GATEWAY_CONFIG_ID: tf.kv.gateway_config,
      B2_RAW_BUCKET: tf.b2.bucket,
      B2_REGION: tf.b2.region,
      B2_ENDPOINT: tf.b2.endpoint,
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
  const {env, tfOutput} = parseArgs(process.argv.slice(2));
  const tf = env === 'local' ? {} : readTfOutputs(tfOutput);
  const vars = buildVars(env, tf);
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
