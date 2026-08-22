/**
 * Drizzle ORM schema definitions for the Cloudflare D1 tables used across
 * the OntoDecide Worker services.
 *
 * These definitions mirror the SQL migrations shipped under
 * `apps/api/user/src/migrations/0001_initial.sql` and
 * `apps/api/ai/src/migrations/0001_decisions.sql`. They are intended to be
 * consumed with `drizzle-orm/sqlite-core` so that the same schema can drive
 * typed query builders, migrations and downstream tooling on top of D1.
 */
import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Users table — the account-lifecycle core of the User Service.
 *
 * One row per user. `tenant_id` and `username` are globally unique. The
 * role and the active / data-cleared flags are guarded by CHECK constraints
 * so only valid enum values ever land in D1.
 */
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id').notNull().unique(),
    username: text('username').notNull().unique(),
    password_hash: text('password_hash').notNull(),
    email: text('email'),
    role: text('role').notNull().default('analyst'),
    is_active: integer('is_active').notNull().default(1),
    is_data_cleared: integer('is_data_cleared').notNull().default(0),
    must_change_password: integer('must_change_password').notNull().default(0),
    expires_at: text('expires_at'),
    created_by: text('created_by'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    last_login_at: text('last_login_at'),
    last_cleanup_at: text('last_cleanup_at'),
    data_retention_days: integer('data_retention_days').notNull().default(30),
    data_size_estimate: integer('data_size_estimate').notNull().default(0),
    metadata: text('metadata'),
  },
  () => [
    check('users_role_check', sql`role IN ('admin', 'analyst', 'viewer')`),
    check('users_is_active_check', sql`is_active IN (0, 1)`),
    check('users_is_data_cleared_check', sql`is_data_cleared IN (0, 1)`),
    check('users_must_change_password_check', sql`must_change_password IN (0, 1)`),
  ],
);

/**
 * Audit logs — every privileged admin operation is recorded here so the
 * system keeps a tamper-evident trail of who did what, when and from where.
 */
export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id').notNull(),
    operator_id: text('operator_id').notNull(),
    action: text('action').notNull(),
    target_user_id: text('target_user_id'),
    details: text('details'),
    ip: text('ip'),
    user_agent: text('user_agent'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  () => [
    check(
      'audit_logs_action_check',
      // eslint-disable-next-line max-len
      sql`action IN ('create_user', 'disable_user', 'enable_user', 'reset_password', 'change_password', 'cleanup_data', 'login', 'logout', 'delete_user')`,
    ),
  ],
);

/**
 * System configuration table — a flat key/value store for runtime-tunable
 * knobs (e.g. global cleanup window, max user count, feature flags).
 */
export const systemConfig = sqliteTable('system_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  description: text('description'),
  updated_at: text('updated_at')
    .notNull()
    .default(sql`(datetime('now'))`),
  updated_by: text('updated_by'),
});

/**
 * Refresh-token registry — tracks every outstanding refresh token so the
 * Gateway can revoke tokens on logout or password reset. Tokens are scoped
 * to a user and cascade-deleted when the owning user is removed.
 */
export const refreshTokens = sqliteTable(
  'refresh_tokens',
  {
    jti: text('jti').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, {
        onDelete: 'cascade',
      }),
    tenant_id: text('tenant_id').notNull(),
    expires_at: text('expires_at').notNull(),
    revoked: integer('revoked').notNull().default(0),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  () => [check('refresh_tokens_revoked_check', sql`revoked IN (0, 1)`)],
);

/**
 * Decisions table — the AI Service persists every decision / recommendation
 * / agent-plan it produces so the dashboard can render history and the
 * budget manager can reason over past runs.
 */
export const decisions = sqliteTable(
  'decisions',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id').notNull(),
    kind: text('kind').notNull(),
    topic: text('topic').notNull(),
    provider: text('provider').notNull(),
    model: text('model'),
    prompt_hash: text('prompt_hash').notNull(),
    payload: text('payload').notNull(),
    neuron_cost: integer('neuron_cost').notNull().default(0),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    metadata: text('metadata'),
  },
  () => [check('decisions_kind_check', sql`kind IN ('scenario', 'recommendation', 'agent_plan')`)],
);

/**
 * Agent runs — one row per PlanningAgent execution, tracking its lifecycle
 * status and the count of planned vs. completed tasks.
 */
export const agentRuns = sqliteTable(
  'agent_runs',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id').notNull(),
    goal: text('goal').notNull(),
    status: text('status').notNull(),
    task_count: integer('task_count').notNull().default(0),
    completed_count: integer('completed_count').notNull().default(0),
    provider: text('provider').notNull(),
    started_at: text('started_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    finished_at: text('finished_at'),
    result: text('result'),
  },
  () => [
    // eslint-disable-next-line max-len
    check(
      'agent_runs_status_check',
      sql`status IN ('idle', 'planning', 'executing', 'reflecting', 'done', 'failed')`,
    ),
  ],
);
