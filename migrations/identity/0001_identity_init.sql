-- identity-access-db: tenants, users, refresh tokens.
CREATE TABLE idn_tenant (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE idn_user (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pwd_hash TEXT NOT NULL,
  pwd_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Admin', 'Modeler', 'Operator', 'Viewer')),
  markings TEXT NOT NULL DEFAULT '[]',
  locale TEXT NOT NULL DEFAULT 'zh-CN',
  disabled INTEGER NOT NULL DEFAULT 0,
  must_change_pwd INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  last_login_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ix_idn_user_tenant ON idn_user (tenant_id);

-- Refresh tokens are stored hashed and rotated per family; replay of a
-- rotated token revokes the whole family.
CREATE TABLE idn_refresh_token (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  family TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  rotated INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_idn_refresh_family ON idn_refresh_token (family);
CREATE INDEX ix_idn_refresh_user ON idn_refresh_token (user_id);

-- Audit of security events (login failures, role changes). Never deleted.
CREATE TABLE idn_audit (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  actor TEXT,
  event TEXT NOT NULL,
  subject TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_idn_audit_tenant ON idn_audit (tenant_id, created_at);
