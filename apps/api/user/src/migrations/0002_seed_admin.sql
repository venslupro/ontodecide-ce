-- ============================================================
-- Migration 0002: seed the bootstrap admin account.
--
-- The password hash below is PBKDF2-SHA256 (100k iterations) of the
-- string "ChangeMeNow!" — operators MUST rotate it on first login via
-- the `POST /admin/users/:id/reset` endpoint.
-- ============================================================

INSERT OR IGNORE INTO users (
  id, tenant_id, username, password_hash, email, role,
  is_active, is_data_cleared, data_retention_days
) VALUES (
  '00000000-0000-0000-0000-root-admin',
  'tenant_root',
  'admin',
  'pbkdf2$100000$REPLACE_AT_DEPLOY$REPLACE_AT_DEPLOY',
  'admin@example.com',
  'admin',
  1,
  0,
  36500  -- effectively never auto-cleanup the bootstrap admin.
);

INSERT OR IGNORE INTO audit_logs (
  id, tenant_id, operator_id, action, target_user_id, details
) VALUES (
  'seed-admin-log',
  'tenant_root',
  'system',
  'create_user',
  '00000000-0000-0000-0000-root-admin',
  '{"note": "Bootstrap admin seeded by migration 0002."}'
);
