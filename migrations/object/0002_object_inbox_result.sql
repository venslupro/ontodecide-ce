-- object-graph-db: object-writes inbox keeps the write result so a retried
-- message can re-report it without re-writing data; action log lookup by
-- recommendation (idempotent approval replays).
ALTER TABLE og_inbox ADD COLUMN tenant_id TEXT;
ALTER TABLE og_inbox ADD COLUMN result TEXT;
ALTER TABLE og_inbox ADD COLUMN reported_at INTEGER;
CREATE INDEX ix_og_inbox_processed ON og_inbox (processed_at);
CREATE INDEX ix_og_action_rec ON og_action_log (tenant_id, recommendation_id);
CREATE INDEX ix_og_link_tenant_type ON og_link (tenant_id, link_type, src_rid, dst_rid);
