-- ============================================================
-- Migration 0001: initial schema for the User Service.
--
-- Mirrors the design doc §4.2.2 schema. Run via
-- `wrangler d1 migrations apply shared-db`.
-- ============================================================

-- Users table (account lifecycle core).
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'analyst' CHECK (role IN ('admin', 'analyst', 'viewer')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  is_data_cleared INTEGER NOT NULL DEFAULT 0 CHECK (is_data_cleared IN (0, 1)),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT,
  last_cleanup_at TEXT,
  data_retention_days INTEGER NOT NULL DEFAULT 30,
  data_size_estimate INTEGER NOT NULL DEFAULT 0,
  metadata TEXT
);

-- Audit log for admin operations.
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'create_user', 'disable_user', 'enable_user',
    'reset_password', 'cleanup_data',
    'login', 'logout', 'delete_user'
  )),
  target_user_id TEXT,
  details TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_operator ON audit_logs(operator_id, created_at);

-- System configuration table.
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT
);

INSERT OR IGNORE INTO system_config (key, value, description) VALUES
  ('global_cleanup_days', '30', 'Global default data-retention window in days.'),
  ('max_users', '50', 'Maximum number of users allowed on this plan.'),
  ('cleanup_enabled', 'true', 'Whether the daily cleanup cron is allowed to run.');

-- Refresh-token registry: tracks outstanding refresh tokens so we can revoke.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  jti TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id, revoked);
