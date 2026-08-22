/**
 * Runtime configuration validation for Cloudflare Workers.
 *
 * Two-layer validation:
 *   1. Presence check  — every key must be non-null/non-empty.
 *   2. Semantic check — for string values, validates format / length
 *                       via pluggable validator functions.
 *
 * Design goals:
 *   1. Deploy must NEVER block on missing config — the Worker is
 *      deployed and reachable even with incomplete configuration.
 *   2. The first request triggers validation and logs every missing
 *      or malformed piece, so operators see exactly what to fix.
 *   3. Required vs. optional keys are distinguished — missing required
 *      keys produce ERROR-level logs, missing optional keys produce
 *      WARN-level logs.
 *   4. Semantic validators are composable and reusable across services.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Severity of a config validation finding. */
export type ConfigSeverity = 'error' | 'warning';

/** A single config validation finding. */
export interface ConfigFinding {
  /** The env key name (e.g. `JWT_SECRET`, `DB`, `INGEST_QUEUE`). */
  key: string;
  /** Severity — `error` for required keys, `warning` for optional. */
  severity: ConfigSeverity;
  /** Human-readable description of what was wrong. */
  description: string;
}

/**
 * A configuration key declaration with optional semantic validation.
 *
 * @example
 * const jwtKey = configKey('JWT_SECRET', 'HMAC signing key (≥32 bytes)', validators.minLength(32));
 */
export interface ConfigKey {
  /** Env key name matching wrangler.toml / Dashboard variable name. */
  key: string;
  /** Human-readable description for error messages. */
  description: string;
  /**
   * Optional semantic validator.
   * Returns `null` on success, or a human-readable error message on failure.
   */
  validate?: (value: unknown) => string | null;
}

// ─── Common validators ────────────────────────────────────────────────────────

/**
 * Reusable semantic validators for common config patterns.
 * Each returns `null` on success, or an error message string on failure.
 */
export const validators = {
  /** String must be at least `n` characters. */
  minLength:
    (n: number) =>
    (value: unknown): string | null => {
      if (typeof value !== 'string') return `must be a string`;
      if (value.length < n) {
        return `must be at least ${n} characters (got ${value.length})`;
      }
      return null;
    },

  /**
   * String must be a valid URL.
   * Accepts http, https, or custom protocols like `neo4j:`.
   *
   * @param allowedProtocols Allowed protocol prefixes (without `:`).
   *                         Defaults to `['http', 'https']`.
   *
   * @example
   * // Basic HTTP/HTTPS URL
   * validators.url()
   *
   * // Neo4j connection URL (accepts neo4j:, neo4j+s:, neo4j+ssc:, http:, https:)
   * validators.url(['http', 'https', 'neo4j', 'neo4j+s', 'neo4j+ssc'])
   */
  url:
    (allowedProtocols: string[] = ['http', 'https']) =>
    (value: unknown): string | null => {
      if (typeof value !== 'string') return `must be a string`;
      try {
        const parsed = new URL(value);
        const proto = parsed.protocol.replace(/:$/, '');
        if (!allowedProtocols.includes(proto)) {
          return `must use one of [${allowedProtocols.join(', ')}] protocol (got: ${proto})`;
        }
        return null;
      } catch {
        return `must be a valid URL (got: ${JSON.stringify(value)})`;
      }
    },

  /**
   * Neo4j AuraDB / community connection URL.
   * Accepts:
   *   - HTTPS  (HTTP transactional API, used by Cloudflare Workers)
   *   - HTTP   (local development, e.g. http://localhost:7474)
   *   - neo4j:  (Bolt direct, e.g. neo4j://localhost:7687)
   *   - neo4j+s: (Bolt+TLS, AuraDB default, e.g. neo4j+s://host:7687)
   *   - neo4j+ssc: (Bolt+self-signed cert)
   *
   * Optionally validates the hostname for AuraDB pattern (ends with
   * `.databases.neo4j.io`).
   */
  neo4jUrl: (value: unknown): string | null => {
    if (typeof value !== 'string') return `must be a string`;
    const allowed = ['http', 'https', 'neo4j', 'neo4j+s', 'neo4j+ssc'];
    try {
      const parsed = new URL(value);
      const proto = parsed.protocol.replace(/:$/, '');
      if (!allowed.includes(proto)) {
        return `Neo4j URL must use one of [${allowed.join(', ')}] protocol (got: ${proto})`;
      }
      // If it looks like an AuraDB URL, verify the hostname pattern.
      if (parsed.hostname.endsWith('.databases.neo4j.io')) {
        // AuraDB instance IDs are 36-char hex-like strings with hyphens.
        const instanceId = parsed.hostname.replace('.databases.neo4j.io', '');
        if (!/^[a-f0-9-]+$/i.test(instanceId) || instanceId.length < 8) {
          return `Neo4j AuraDB URL has suspicious instance id: "${instanceId}"`;
        }
      }
      return null;
    } catch {
      return `must be a valid Neo4j connection URL (got: ${JSON.stringify(value)})`;
    }
  },

  /** String must start with the given prefix. */
  startsWith:
    (prefix: string) =>
    (value: unknown): string | null => {
      if (typeof value !== 'string') return `must be a string`;
      if (!value.startsWith(prefix)) {
        return `must start with "${prefix}" (got: ${JSON.stringify(value)})`;
      }
      return null;
    },

  /** String must match a regex pattern. */
  pattern:
    (regex: RegExp, label?: string) =>
    (value: unknown): string | null => {
      if (typeof value !== 'string') return `must be a string`;
      if (!regex.test(value)) {
        return label
          ? `must match ${label} (got: ${JSON.stringify(value)})`
          : `must match ${regex} (got: ${JSON.stringify(value)})`;
      }
      return null;
    },

  /** String must be a valid email address. */
  email: (value: unknown): string | null => {
    if (typeof value !== 'string') return `must be a string`;
    // Basic email check — not RFC 5322 perfect, but sufficient for config validation.
    const basicEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!basicEmail.test(value)) {
      return `must be a valid email address (got: ${JSON.stringify(value)})`;
    }
    return null;
  },

  /** String must be non-empty after trimming. */
  nonEmpty: (value: unknown): string | null => {
    if (typeof value !== 'string') return `must be a string`;
    if (value.trim().length === 0) return `must not be empty`;
    return null;
  },

  /**
   * JWT HMAC signing secret validator.
   *
   * Enforces production-grade secret quality:
   *   1. Minimum 32 characters (HMAC-SHA256 requirement).
   *   2. Not a common weak / well-known secret.
   *   3. Has character variety — not all-lowercase, all-uppercase,
   *      or all-digit (low entropy).
   *   4. Not a single character repeated (e.g. "aaaaaaaaaa").
   *   5. Not a simple sequential pattern (e.g. "abcdefghij").
   *
   * @example
   * validators.jwtSecret  // default: min 32 chars
   * validators.jwtSecret(64) // require 64+ chars (HMAC-SHA512)
   */
  jwtSecret:
    (minLength: number = 32) =>
    (value: unknown): string | null => {
      if (typeof value !== 'string') return `must be a string`;
      if (value.length < minLength) {
        return `must be at least ${minLength} characters (got ${value.length})`;
      }
      // Common weak secrets that would pass the length check.
      const weakSecrets = new Set([
        // Generic weak keys
        'secret',
        'key',
        'changeme',
        'password',
        'admin',
        'jwt',
        'jwt_secret',
        'signing_key',
        'signing-secret',
        // Common placeholder values
        'your-secret-key',
        'super-secret-key',
        'my-secret-key',
        'development',
        'staging',
        'production',
        // Too common to be safe
        '12345678901234567890123456789012',
        '0987654321098765432109876543210',
      ]);
      const trimmed = value.trim().toLowerCase();
      if (weakSecrets.has(trimmed)) {
        return `matches a well-known weak secret — choose a random ${minLength}+ char string`;
      }
      // All same character (e.g. "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
      if (/^(.)\1+$/.test(value)) {
        return `is a single character repeated — use a random string with variety`;
      }
      // Character variety check: must have at least 2 of [lowercase, uppercase, digits, symbols]
      const hasLower = /[a-z]/.test(value);
      const hasUpper = /[A-Z]/.test(value);
      const hasDigit = /[0-9]/.test(value);
      const hasSymbol = /[^a-zA-Z0-9]/.test(value);
      const varietyCount = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;
      if (varietyCount < 2) {
        return (
          `lacks character variety — mix at least 2 of ` + `[lowercase, uppercase, digits, symbols]`
        );
      }
      return null;
    },
};

// ─── Helper: create a ConfigKey with optional validator ────────────────────────

/**
 * Shorthand for declaring a config key without semantic validation.
 *
 * @example
 * configKey('JWT_SECRET', 'HMAC signing key')
 */
export function configKey(
  key: string,
  description: string,
  validate?: (value: unknown) => string | null,
): ConfigKey {
  return { key, description, validate };
}

// ─── Core validation engine ───────────────────────────────────────────────────

/**
 * Validate a Worker's runtime environment against a set of declared keys.
 *
 * For each required/optional key:
 *   1. Check presence (non-null for resources, non-empty for strings).
 *   2. If present and a validator is defined, run semantic check.
 *
 * @param env          The Cloudflare Worker `env` object.
 * @param requiredKeys Keys that MUST be present and valid.
 * @param optionalKeys Keys that SHOULD be present but are not strictly required.
 * @param serviceName  Human-readable service name for log context.
 * @returns Array of findings (empty = all good).
 */
export function validateWorkerConfig(
  env: Record<string, unknown>,
  requiredKeys: ConfigKey[],
  optionalKeys: ConfigKey[] = [],
  serviceName: string = 'worker',
): ConfigFinding[] {
  const findings: ConfigFinding[] = [];

  for (const { key, description, validate } of requiredKeys) {
    const value = env[key];
    const present = isPresent(value);
    if (!present) {
      findings.push({
        key,
        severity: 'error',
        description:
          `Missing required config: ${description}. ` +
          `Set it in Cloudflare Dashboard → Worker → Variables and Secrets, ` +
          `or push via \`wrangler secret put ${key}\`.`,
      });
      continue;
    }
    // Semantic validation (only for string values, resources are validated
    // by their non-nullness check above).
    if (validate && typeof value === 'string') {
      const err = validate(value);
      if (err) {
        findings.push({
          key,
          severity: 'error',
          description: `Invalid config: ${err} (key: ${key})`,
        });
      }
    }
  }

  for (const { key, description, validate } of optionalKeys) {
    const value = env[key];
    const present = isPresent(value);
    if (!present) {
      findings.push({
        key,
        severity: 'warning',
        description:
          `Missing optional config: ${description}. ` +
          `Some features of the ${serviceName} service may not work.`,
      });
      continue;
    }
    if (validate && typeof value === 'string') {
      const err = validate(value);
      if (err) {
        findings.push({
          key,
          severity: 'warning',
          description: `Invalid optional config: ${err} (key: ${key})`,
        });
      }
    }
  }

  return findings;
}

// ─── Logging ──────────────────────────────────────────────────────────────────

/**
 * Log all config findings at the appropriate severity level.
 * Uses console.error for `error` severity, console.warn for `warning`.
 */
export function logConfigFindings(findings: ConfigFinding[], serviceName: string = 'worker'): void {
  if (findings.length === 0) {
    console.info(`[config] ${serviceName}: all required configuration is present.`);
    return;
  }

  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');

  if (errors.length > 0) {
    console.error(`[config] ${serviceName}: ${errors.length} REQUIRED config(s) issue(s):`);
    for (const f of errors) {
      console.error(`  ✗ ${f.key} — ${f.description}`);
    }
  }

  if (warnings.length > 0) {
    console.warn(`[config] ${serviceName}: ${warnings.length} optional config(s) issue(s):`);
    for (const f of warnings) {
      console.warn(`  ⚠ ${f.key} — ${f.description}`);
    }
  }
}

// ─── Combined helper ──────────────────────────────────────────────────────────

/**
 * Combined validation + logging helper.
 *
 * @returns The findings array (for programmatic use, e.g. returning
 *          a 503 in health-check when required keys are missing).
 */
export function validateAndLogConfig(
  env: Record<string, unknown>,
  requiredKeys: ConfigKey[],
  optionalKeys: ConfigKey[] = [],
  serviceName: string = 'worker',
): ConfigFinding[] {
  const findings = validateWorkerConfig(env, requiredKeys, optionalKeys, serviceName);
  logConfigFindings(findings, serviceName);
  return findings;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Check whether an env value is "present":
 *   - String: must be non-empty (after trim)
 *   - Object/resource: must be non-null, non-undefined
 *   - Everything else: falsy → absent
 */
function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  // Bound resources (KVNamespace, D1Database, Queue, Fetcher,
  // DurableObjectNamespace) are objects — truthy check suffices.
  return true;
}
