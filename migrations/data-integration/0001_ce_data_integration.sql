-- data-integration-db (CE V2.4; 详细设计 6.2, 6.11.2). Jobs and mappings
-- only: raw files are parsed in the browser and never stored.
DROP TABLE IF EXISTS int_ingest_msg;
DROP TABLE IF EXISTS int_job_batch;
DROP TABLE IF EXISTS int_job_group;
DROP TABLE IF EXISTS int_raw_record;
DROP TABLE IF EXISTS int_webhook_nonce;
DROP TABLE IF EXISTS ops_job_run;
DROP TABLE IF EXISTS int_job;
DROP TABLE IF EXISTS int_source;

-- Saved field mappings.
CREATE TABLE int_mapping (
  tenant_id   TEXT NOT NULL,
  id          TEXT NOT NULL,
  name        TEXT,
  target_type TEXT NOT NULL,
  spec        TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE int_job (
  tenant_id   TEXT NOT NULL,
  id          TEXT NOT NULL,
  file_name   TEXT,
  target_type TEXT NOT NULL,
  mapping     TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('file', 'sample')),
  status      TEXT NOT NULL CHECK (status IN ('RECEIVING', 'DONE', 'FAILED')),
  total_rows  INTEGER NOT NULL,
  received    INTEGER NOT NULL DEFAULT 0,
  upserted    INTEGER NOT NULL DEFAULT 0,
  skipped     INTEGER NOT NULL DEFAULT 0,
  rejected    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

-- Synchronous write result per batch; a retried seq returns it (idempotent).
CREATE TABLE int_batch (
  tenant_id TEXT NOT NULL,
  job_id    TEXT NOT NULL,
  seq       INTEGER NOT NULL,
  rows      INTEGER NOT NULL,
  result    TEXT NOT NULL,
  PRIMARY KEY (tenant_id, job_id, seq)
);

-- Column name and error type only, never the cell value; ≤ 200 per job.
CREATE TABLE int_reject (
  tenant_id  TEXT NOT NULL,
  job_id     TEXT NOT NULL,
  row_no     INTEGER NOT NULL,
  error_code TEXT NOT NULL,
  detail     TEXT,
  PRIMARY KEY (tenant_id, job_id, row_no)
);

-- scope: tenant id, or '*' for the service-wide budget.
CREATE TABLE int_usage (
  day   TEXT NOT NULL,
  scope TEXT NOT NULL,
  key   TEXT NOT NULL CHECK (key IN
          ('import_rows', 'seed_rows', 'seed_loaded', 'mapping_ai', 'neurons')),
  value INTEGER NOT NULL,
  PRIMARY KEY (day, scope, key)
);

CREATE TABLE tenant_tombstone (
  tenant_id  TEXT PRIMARY KEY,
  deleted_at INTEGER NOT NULL
);
