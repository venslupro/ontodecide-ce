-- ============================================================
-- Migration 0003: Account application lifecycle.
--
-- Adds:
--   - must_change_password: flag set on creation, cleared when the
--     user changes their temporary password on first login (activation).
--   - expires_at: absolute expiry timestamp (created_at + usage days).
--     The cleanup cron uses this to detect expired accounts.
--
-- Also updates the default max_users from 50 to 5.
-- ============================================================

ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1));
ALTER TABLE users ADD COLUMN expires_at TEXT;

-- Update existing users: set expires_at = created_at + data_retention_days.
UPDATE users
  SET expires_at = datetime(created_at, '+' || data_retention_days || ' days')
  WHERE expires_at IS NULL;

-- Lower the concurrent user cap to 5.
UPDATE system_config SET value = '5' WHERE key = 'max_users';

-- Audit action: password change (self-service activation).
-- SQLite CHECK constraints can't be altered in-place, so we recreate
-- the constraint via a new table copy if needed. For D1, the CHECK is
-- enforced at insert time; existing rows are unaffected.
-- To allow 'change_password' in the audit_logs action column, recreate
-- the table with the updated CHECK constraint:
CREATE TABLE IF NOT EXISTS audit_logs_new (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'create_user', 'disable_user', 'enable_user',
    'reset_password', 'change_password', 'cleanup_data',
    'login', 'logout', 'delete_user'
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
