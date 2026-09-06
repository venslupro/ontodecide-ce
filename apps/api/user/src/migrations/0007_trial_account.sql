-- ============================================================
-- Migration 0007: Self-service trial (experience) account.
--
-- Adds:
--   - system_config rows for trial tuning (retention days, max
--     concurrent trial accounts).
--   - audit_logs action 'apply_account' so self-service sign-ups
--     leave an auditable trail. The CHECK constraint is recreated
--     via a table copy (SQLite cannot alter CHECK in place).
-- ============================================================

-- Trial runtime configuration (overridable by admin).
INSERT OR IGNORE INTO system_config (key, value, description) VALUES
  ('trial_retention_days', '14', '体验账号有效期（天）'),
  ('trial_max_users', '5', '体验账号最大并发数量');

-- Extend audit_logs.action CHECK to include 'apply_account'.
CREATE TABLE IF NOT EXISTS audit_logs_new (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'create_user', 'disable_user', 'enable_user',
    'reset_password', 'change_password', 'cleanup_data',
    'login', 'logout', 'delete_user', 'apply_account'
  )),
  target_user_id TEXT,
  details TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO audit_logs_new SELECT * FROM audit_logs;
DROP TABLE audit_logs;
ALTER TABLE audit_logs_new RENAME TO audit_logs;
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_operator ON audit_logs(operator_id, created_at);
