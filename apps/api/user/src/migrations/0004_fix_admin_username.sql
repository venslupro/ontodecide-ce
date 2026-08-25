-- ============================================================
-- Migration 0004: fix bootstrap admin username to be email-shaped.
--
-- The original 0002 seed used username='admin' (non-email) and
-- email='admin@example.com'. Per project constraint "Usernames
-- must be email addresses (login name)" we align the bootstrap
-- admin on both columns to 'admin@ontodecide.ai'.
--
-- This migration is idempotent: it only updates rows where the
-- legacy username/email is present, so environments that already
-- have the corrected seed (new 0002) are no-ops.
-- ============================================================

UPDATE users
  SET username = 'admin@ontodecide.ai',
      email    = 'admin@ontodecide.ai'
  WHERE id = '00000000-0000-0000-0000-root-admin'
    AND (username = 'admin' OR email = 'admin@example.com');
