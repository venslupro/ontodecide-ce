-- ============================================================
-- Migration 0005: tune defaults for admin-only signup + inactive cleanup.
--
--   1. Bump max_users default from 50 -> 20 on legacy deployments
--      (new deployments get 20 from 0001_initial.sql via INSERT OR IGNORE).
--      Admins who already personalised max_users to a non-50 value are
--      NOT overwritten — the UPDATE targets only the legacy default.
--   2. Add the inactive_days_threshold config knob used by the Cleanup
--      Worker cron to reclaim storage from long-idle tenants.
-- ============================================================

-- Bring legacy installations (initialised with 0001's old value of 50)
-- up to the new baseline of 20. Manual admin customisations (e.g. 10, 42)
-- are explicitly preserved by the WHERE predicate.
UPDATE system_config
SET value = '20',
    description = 'Maximum number of users allowed on this plan.',
    updated_at  = datetime('now')
WHERE key = 'max_users'
  AND value = '50';

-- Threshold (in days) after which a non-admin, non-cleared, still-active
-- tenant whose last_login_at (or created_at when never logged in) falls
-- behind the cron wall-clock will have its data softly reclaimed.
INSERT OR IGNORE INTO system_config (key, value, description) VALUES
  (
    'inactive_days_threshold',
    '30',
    'Days of inactivity (no login) after which a non-admin tenant data is softly reclaimed.'
  );
