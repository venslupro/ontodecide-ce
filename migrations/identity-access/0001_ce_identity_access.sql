-- identity-access-db (CE V2.4; 修订说明书 6.5 / 8.2 / 9.5, 详细设计 6.2).
-- Replaces the V1.3 password/RBAC schema. All data in the V1.3 tables is
-- dropped: the CE keeps no passwords, roles or markings.
PRAGMA defer_foreign_keys = true;
DROP TABLE IF EXISTS idn_refresh_token;
DROP TABLE IF EXISTS idn_audit;
DROP TABLE IF EXISTS idn_registration;
DROP TABLE IF EXISTS idn_user_v2;
DROP TABLE IF EXISTS idn_user;
DROP TABLE IF EXISTS idn_tenant;

-- One workspace per user; exactly one admin workspace in the system.
CREATE TABLE workspace (
  tenant_id        TEXT PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('trial', 'admin')),
  owner_user_id    TEXT NOT NULL UNIQUE
                   REFERENCES user_account (user_id) DEFERRABLE INITIALLY DEFERRED,
  status           TEXT NOT NULL CHECK (status IN ('ACTIVE', 'EXPIRED', 'ARCHIVING')),
  -- trial: verified_at + 72 h (rewritten by early termination / admin);
  -- admin: NULL (never expires).
  trial_expires_at INTEGER,
  -- When the workspace entered EXPIRED; archiving starts 16 min later.
  expired_at       INTEGER,
  -- Set by an admin delete; NULL means archive.
  delete_mode      TEXT CHECK (delete_mode IN ('archive', 'no_archive')),
  created_at       INTEGER NOT NULL,
  CHECK ((kind = 'admin' AND trial_expires_at IS NULL AND status = 'ACTIVE')
      OR (kind = 'trial' AND trial_expires_at IS NOT NULL))
);
CREATE UNIQUE INDEX ux_one_admin_ws ON workspace (kind) WHERE kind = 'admin';
CREATE INDEX ix_workspace_status ON workspace (kind, status, trial_expires_at);

CREATE TABLE user_account (
  user_id     TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL UNIQUE
              REFERENCES workspace (tenant_id) DEFERRABLE INITIALLY DEFERRED,
  role        TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin')),
  -- HMAC(pepper, normalized e-mail): uniqueness without plaintext.
  email_hmac  TEXT NOT NULL UNIQUE,
  -- AES-GCM ciphertext (iv.ct, base64url); only identity-access decrypts.
  email_enc   TEXT NOT NULL,
  locale      TEXT NOT NULL DEFAULT 'zh-CN' CHECK (locale IN ('zh-CN', 'en-US')),
  time_zone   TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  verified_at INTEGER NOT NULL,
  reminded_at INTEGER,
  banned_at   INTEGER
);
CREATE UNIQUE INDEX ux_one_admin ON user_account (role) WHERE role = 'admin';

CREATE TRIGGER trg_admin_no_delete BEFORE DELETE ON user_account
WHEN OLD.role = 'admin'
BEGIN SELECT RAISE(ABORT, 'bootstrap admin cannot be deleted'); END;

CREATE TRIGGER trg_admin_no_demote BEFORE UPDATE OF role ON user_account
WHEN OLD.role = 'admin'
BEGIN SELECT RAISE(ABORT, 'bootstrap admin role is immutable'); END;

CREATE TRIGGER trg_admin_ws_no_delete BEFORE DELETE ON workspace
WHEN OLD.kind = 'admin'
BEGIN SELECT RAISE(ABORT, 'admin workspace cannot be deleted'); END;

CREATE TRIGGER trg_admin_ws_no_expire BEFORE UPDATE OF status, trial_expires_at ON workspace
WHEN OLD.kind = 'admin' AND (NEW.status <> 'ACTIVE' OR NEW.trial_expires_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'admin workspace never expires'); END;

-- Pending one-time codes. Only the code HMAC is stored.
CREATE TABLE pending_code (
  email_hmac TEXT NOT NULL,
  purpose    TEXT NOT NULL CHECK (purpose IN ('signup', 'login', 'terminate')),
  -- Only signup keeps the encrypted e-mail (the account does not exist yet).
  email_enc  TEXT,
  locale     TEXT,
  code_hmac  TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  -- now + 10 min; deleted by cron 30 min after issue.
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (email_hmac, purpose)
);

-- Per e-mail per day: ≤ 5 sends; 10 failures lock for 24 h.
CREATE TABLE otp_limit (
  email_hmac   TEXT NOT NULL,
  day          TEXT NOT NULL,
  sends        INTEGER NOT NULL DEFAULT 0,
  failures     INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  PRIMARY KEY (email_hmac, day)
);

-- Refresh sessions. Owner: expires ≤ trial end; admin: ≤ 8 h; ≤ 3 per user.
CREATE TABLE session (
  session_id   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES user_account (user_id),
  -- Rotation family: a replayed old token revokes the whole family.
  family_id    TEXT NOT NULL,
  -- SHA-256 of the current __Host-od_rt value.
  refresh_hash TEXT NOT NULL UNIQUE,
  amr          TEXT NOT NULL DEFAULT '["otp"]',
  -- Short client label (e.g. "Chrome · macOS"), no raw user agent.
  client       TEXT,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX ix_session_family ON session (family_id);
CREATE INDEX ix_session_user ON session (user_id, created_at);

-- Hashes of refresh tokens already rotated away (replay detection).
CREATE TABLE session_rotated (
  refresh_hash TEXT PRIMARY KEY,
  family_id    TEXT NOT NULL,
  expires_at   INTEGER NOT NULL
);

-- Archive saga progress (no personal data); one cron step per call.
CREATE TABLE purge_ledger (
  tenant_id     TEXT PRIMARY KEY,
  phase         TEXT NOT NULL CHECK (phase IN
                  ('exporting', 'exported', 'mailed', 'purging', 'purged', 'account_deleted')),
  mode          TEXT NOT NULL CHECK (mode IN ('archive', 'no_archive', 'empty')),
  -- archives/{tid}/{random 128 bit}.zip, generated once.
  object_key    TEXT,
  export_svc    TEXT,
  export_cursor TEXT,
  -- Staging parts staging/{tid}/{n}.part written so far.
  parts         INTEGER NOT NULL DEFAULT 0,
  size_bytes    INTEGER,
  sha256        TEXT,
  purge_svc     TEXT,
  locale        TEXT,
  time_zone     TEXT,
  expired_at    INTEGER NOT NULL,
  mailed        INTEGER,
  attempts      INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX ix_purge_ledger_next ON purge_ledger (phase, updated_at);

-- The only record left after an account is deleted (no personal data).
CREATE TABLE archive_index (
  tenant_id           TEXT PRIMARY KEY,
  object_key          TEXT NOT NULL,
  size_bytes          INTEGER NOT NULL,
  sha256              TEXT NOT NULL,
  -- SHA-256 of the 256-bit "delete now" token; overwritten on mail retry.
  deletion_token_hash TEXT NOT NULL UNIQUE,
  created_at          INTEGER NOT NULL,
  -- created_at + 7 days, when the presigned link also expires.
  expires_at          INTEGER NOT NULL
);
CREATE INDEX ix_archive_index_expiry ON archive_index (expires_at);

CREATE TABLE tenant_tombstone (
  tenant_id  TEXT PRIMARY KEY,
  deleted_at INTEGER NOT NULL
);

-- Capped counters: signup, signup_ip:{hmac}, signup_closed, purge_rows,
-- email:resend, email:brevo, email:resend:month:{yyyy-mm}, archive_* metrics.
CREATE TABLE usage_counter (
  day   TEXT NOT NULL,
  key   TEXT NOT NULL,
  value INTEGER NOT NULL,
  PRIMARY KEY (day, key)
);

-- Admin second factor: ≥ 2 passkeys, 10 recovery codes, challenges.
CREATE TABLE admin_passkey (
  credential_id TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES user_account (user_id),
  public_key    TEXT NOT NULL,
  -- A sign_count that goes backwards is rejected (cloned authenticator).
  sign_count    INTEGER NOT NULL DEFAULT 0,
  transports    TEXT,
  label         TEXT,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER
);

CREATE TABLE admin_recovery_code (
  code_hash TEXT PRIMARY KEY,
  used_at   INTEGER
);

CREATE TABLE webauthn_challenge (
  challenge  TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  purpose    TEXT NOT NULL CHECK (purpose IN ('register', 'assert', 'step_up')),
  expires_at INTEGER NOT NULL
);

-- Written by the controlled ops script only; 24 h cool-down.
CREATE TABLE admin_pending_change (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('email', 'passkey_reset')),
  payload      TEXT,
  requested_at INTEGER NOT NULL,
  effective_at INTEGER NOT NULL,
  notified_at  INTEGER,
  applied_at   INTEGER
);

-- One-shot system flags (e.g. setup_code_used).
CREATE TABLE system_flag (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL,
  at    INTEGER NOT NULL
);

CREATE TABLE platform_setting (
  key        TEXT PRIMARY KEY CHECK (key IN
               ('signup_enabled', 'signup_daily_limit', 'active_workspace_limit')),
  value      INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((key = 'signup_enabled' AND value IN (0, 1))
      OR (key = 'signup_daily_limit' AND value BETWEEN 0 AND 20)
      OR (key = 'active_workspace_limit' AND value BETWEEN 0 AND 60))
);
INSERT INTO platform_setting (key, value, updated_at) VALUES
  ('signup_enabled', 1, 0),
  ('signup_daily_limit', 20, 0),
  ('active_workspace_limit', 60, 0);

CREATE TABLE blocked_domain (
  domain   TEXT PRIMARY KEY,
  added_at INTEGER NOT NULL
);

CREATE TABLE blocked_email (
  email_hmac TEXT PRIMARY KEY,
  added_at   INTEGER NOT NULL
);

-- Append-only admin audit with a hash chain; retention 90 days.
CREATE TABLE admin_audit (
  id               TEXT PRIMARY KEY,
  at               INTEGER NOT NULL,
  -- user.patch / user.delete / sessions.revoke / act_as.enter / tenant.write /
  -- email.view / archive.download / archive.delete / settings.update /
  -- domains.replace / passkey.add / passkey.delete
  action           TEXT NOT NULL,
  target_tenant_id TEXT,
  target_user_id   TEXT,
  reason           TEXT,
  -- Idempotency-Key of /admin/* writes (a replay returns the first result).
  idempotency_key  TEXT UNIQUE,
  result           TEXT,
  prev_hash        TEXT NOT NULL,
  -- SHA-256(prev_hash ‖ canonical row content).
  row_hash         TEXT NOT NULL
);
CREATE INDEX ix_admin_audit_at ON admin_audit (at);

CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON admin_audit
BEGIN SELECT RAISE(ABORT, 'admin_audit is append-only'); END;

CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON admin_audit
WHEN OLD.at > (unixepoch() - 90 * 86400) * 1000
BEGIN SELECT RAISE(ABORT, 'admin_audit is append-only'); END;
