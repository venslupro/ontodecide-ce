/**
 * Runtime configuration validation for Cloudflare Workers.
 *
 * Unlike the CI/CD deploy step (which is best-effort), this module
 * enforces config correctness at Worker startup. Each Worker calls
 * {@link validateWorkerConfig} on first request to surface clear
 * warnings for missing secrets, empty vars, or unbound resources.
 *
 * Design goals:
 *   1. Deploy must NEVER block on missing config — the Worker is
 *      deployed and reachable even with incomplete configuration.
 *   2. The first request triggers validation and logs every missing
 *      piece, so operators see exactly what to fix.
 *   3. Required vs. optional keys are distinguished — missing required
 *      keys produce ERROR-level logs, missing optional keys produce
 *      WARN-level logs.
 */

/** Severity of a config validation finding. */
export type ConfigSeverity = 'error' | 'warning';

/** A single config validation finding. */
export interface ConfigFinding {
  /** The env key name (e.g. `JWT_SECRET`, `DB`, `INGEST_QUEUE`). */
  key: string;
  /** Severity — `error` for required keys, `warning` for optional. */
  severity: ConfigSeverity;
  /** Human-readable description of what this key is for. */
  description: string;
}

/**
 * Validate a Worker's runtime environment against a set of expected keys.
 *
 * @param env            The Cloudflare Worker `env` object (string vars +
 *                       bound resources like KVNamespace, D1Database, Queue).
 * @param requiredKeys   Keys that MUST be present and non-empty.
 *                       String values are checked for non-emptiness;
 *                       bound resources are checked for non-nullness.
 * @param optionalKeys   Keys that SHOULD be present but are not strictly
 *                       required. Missing optional keys produce warnings.
 * @param serviceName    Human-readable service name (e.g. "gateway",
 *                       "ingestion") used in log messages.
 * @returns Array of findings (empty = all good).
 */
export function validateWorkerConfig(
    env: Record<string, unknown>,
    requiredKeys: string[],
    optionalKeys: string[] = [],
    serviceName: string = 'worker',
): ConfigFinding[] {
  const findings: ConfigFinding[] = [];

  for (const key of requiredKeys) {
    const value = env[key];
    if (!isPresent(value)) {
      findings.push({
        key,
        severity: 'error',
        description: `Missing required config: ${key} is not set. ` +
          `Set it in Cloudflare Dashboard → Worker → Variables and Secrets, ` +
          `or push via \`wrangler secret put ${key}\`.`,
      });
    }
  }

  for (const key of optionalKeys) {
    const value = env[key];
    if (!isPresent(value)) {
      findings.push({
        key,
        severity: 'warning',
        description: `Missing optional config: ${key} is not set. ` +
          `Some features of the ${serviceName} service may not work.`,
      });
    }
  }

  return findings;
}

/**
 * Log all config findings at the appropriate severity level.
 * Uses console.error for `error` severity, console.warn for `warning`.
 *
 * @param findings  Output of {@link validateWorkerConfig}.
 * @param serviceName  Human-readable service name for log context.
 */
export function logConfigFindings(
    findings: ConfigFinding[],
    serviceName: string = 'worker',
): void {
  if (findings.length === 0) {
    console.info(
        `[config] ${serviceName}: all required configuration is present.`,
    );
    return;
  }

  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');

  if (errors.length > 0) {
    console.error(
        `[config] ${serviceName}: ${errors.length} REQUIRED config(s) missing:`,
    );
    for (const f of errors) {
      console.error(`  ✗ ${f.key} — ${f.description}`);
    }
  }

  if (warnings.length > 0) {
    console.warn(
        `[config] ${serviceName}: ${warnings.length} optional config(s) missing:`,
    );
    for (const f of warnings) {
      console.warn(`  ⚠ ${f.key} — ${f.description}`);
    }
  }
}

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

/**
 * Combined validation + logging helper.
 *
 * @param env            Worker env object.
 * @param requiredKeys   Required key names.
 * @param optionalKeys   Optional key names (defaults to `[]`).
 * @param serviceName    Service name for log context.
 * @returns The findings array (for programmatic use, e.g. returning
 *          a 503 in health-check when required keys are missing).
 */
export function validateAndLogConfig(
    env: Record<string, unknown>,
    requiredKeys: string[],
    optionalKeys: string[] = [],
    serviceName: string = 'worker',
): ConfigFinding[] {
  const findings = validateWorkerConfig(env, requiredKeys, optionalKeys, serviceName);
  logConfigFindings(findings, serviceName);
  return findings;
}
