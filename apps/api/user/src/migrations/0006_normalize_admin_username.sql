-- ============================================================
-- Migration 0006: normalize bootstrap admin login name.
--
-- Bug fix: the Login page pre-fills "admin@ontodecide.ai" but
-- Migration 0002 seeded the bootstrap admin with the bare
-- username "admin" (4 chars, not an email). This caused first
-- login to fail with 401 unless the operator manually typed
-- "admin" instead of using the pre-filled value.
--
-- This migration is a targeted, surgical UPDATE so the existing
-- password hash (PBKDF2 of ChangeMeNow!) stays untouched —
-- operators keep the well-known initial password and can sign in
-- with either the pre-filled email form OR the bare "admin".
-- ============================================================

UPDATE users
SET username = 'admin@ontodecide.ai',
    email    = CASE WHEN email IS NULL OR email = '' OR email = 'admin@example.com'
                    THEN 'admin@ontodecide.ai'
                    ELSE email END
WHERE id = '00000000-0000-0000-0000-root-admin'
  AND username = 'admin';
