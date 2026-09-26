-- data-integration-db: sources, jobs (dataset transactions), rejected records.
CREATE TABLE int_source (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('file', 'rest', 'webhook')),
  config TEXT NOT NULL DEFAULT '{}',
  secret_enc TEXT,
  mapping TEXT NOT NULL,
  quality_rules TEXT NOT NULL DEFAULT '[]',
  conflict_policy TEXT NOT NULL DEFAULT 'latest-wins',
  priority INTEGER NOT NULL DEFAULT 0,
  schedule TEXT,
  cursor TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  paused INTEGER NOT NULL DEFAULT 0,
  last_job_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_int_source_tenant ON int_source (tenant_id);

CREATE TABLE int_job (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  txn_type TEXT NOT NULL DEFAULT 'APPEND',
  status TEXT NOT NULL,
  received INTEGER NOT NULL DEFAULT 0,
  upserted INTEGER NOT NULL DEFAULT 0,
  merged INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  total_groups INTEGER NOT NULL DEFAULT 0,
  done_groups INTEGER NOT NULL DEFAULT 0,
  last_seen INTEGER NOT NULL DEFAULT 0,
  b2_key TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX ix_int_job_source ON int_job (tenant_id, source_id, started_at);

-- Rejected records; 30-day TTL.
CREATE TABLE int_raw_record (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  row_no INTEGER NOT NULL,
  payload TEXT NOT NULL,
  error_code TEXT NOT NULL,
  error_detail TEXT,
  replayed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_int_raw_job ON int_raw_record (job_id);
CREATE INDEX ix_int_raw_created ON int_raw_record (created_at);

-- Webhook replay protection (signatures seen within the 5-minute window).
CREATE TABLE int_webhook_nonce (
  signature TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  ts INTEGER NOT NULL
);

-- Group-level write results, for idempotent reportWriteResult.
CREATE TABLE int_job_group (
  job_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  reported_at INTEGER NOT NULL,
  PRIMARY KEY (job_id, seq)
);

-- Scheduled task runs.
CREATE TABLE ops_job_run (
  id TEXT PRIMARY KEY,
  job TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL,
  detail TEXT
);
