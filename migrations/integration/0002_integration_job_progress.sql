-- data-integration-db: idempotent job progress tracking.
-- A job completes once the last batch was submitted, every batch 0..last_seq
-- was recorded, every ingest message was processed and every object-writes
-- group was reported.
ALTER TABLE int_job ADD COLUMN last_seq INTEGER;
ALTER TABLE int_job ADD COLUMN batches INTEGER NOT NULL DEFAULT 0;
ALTER TABLE int_job ADD COLUMN ingest_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE int_job ADD COLUMN ingest_done INTEGER NOT NULL DEFAULT 0;
ALTER TABLE int_job ADD COLUMN warnings INTEGER NOT NULL DEFAULT 0;
ALTER TABLE int_job ADD COLUMN quality_score REAL;
CREATE INDEX ix_int_job_tenant ON int_job (tenant_id, started_at);

-- Client batches recorded per job (dedup of submitBatch retries).
CREATE TABLE int_job_batch (
  tenant_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  records INTEGER NOT NULL,
  messages INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (job_id, seq)
);

-- Ingest messages processed per job (dedup of queue redeliveries).
CREATE TABLE int_ingest_msg (
  tenant_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  groups INTEGER NOT NULL,
  processed_at INTEGER NOT NULL,
  PRIMARY KEY (job_id, seq)
);
CREATE INDEX ix_int_ingest_msg_processed ON int_ingest_msg (processed_at);
CREATE INDEX ix_int_webhook_nonce_ts ON int_webhook_nonce (ts);
