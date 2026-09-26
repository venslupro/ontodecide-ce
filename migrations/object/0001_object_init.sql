-- object-graph-db: the authoritative object and link store.
CREATE TABLE og_object (
  rid TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  object_type TEXT NOT NULL,
  primary_key TEXT NOT NULL,
  title TEXT,
  props TEXT NOT NULL,
  -- SHA-256 of canonical props JSON; unchanged records skip the write.
  props_hash TEXT NOT NULL,
  -- {prop: Provenance}
  provenance TEXT NOT NULL,
  -- {prop: [Provenance & {value}]} overwritten values, ≤ 5 per property.
  prov_history TEXT NOT NULL DEFAULT '{}',
  schema_version TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  UNIQUE (tenant_id, object_type, primary_key)
);
CREATE INDEX ix_og_object_type ON og_object (tenant_id, object_type, updated_at);
CREATE INDEX ix_og_object_title ON og_object (tenant_id, title);

-- Only indexed=true properties.
CREATE TABLE og_prop_index (
  tenant_id TEXT NOT NULL,
  object_type TEXT NOT NULL,
  prop TEXT NOT NULL,
  rid TEXT NOT NULL,
  num_val REAL,
  str_val TEXT,
  PRIMARY KEY (rid, prop)
);
CREATE INDEX ix_prop_num ON og_prop_index (tenant_id, object_type, prop, num_val);
CREATE INDEX ix_prop_str ON og_prop_index (tenant_id, object_type, prop, str_val);

CREATE TABLE og_link (
  tenant_id TEXT NOT NULL,
  link_type TEXT NOT NULL,
  src_rid TEXT NOT NULL,
  dst_rid TEXT NOT NULL,
  weight REAL,
  props TEXT,
  PRIMARY KEY (link_type, src_rid, dst_rid)
);
CREATE INDEX ix_link_src ON og_link (src_rid, link_type);
CREATE INDEX ix_link_dst ON og_link (dst_rid, link_type);

CREATE TABLE og_object_alias (
  tenant_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  external_key TEXT NOT NULL,
  rid TEXT NOT NULL,
  PRIMARY KEY (source_id, external_key)
);

CREATE TABLE og_merge_suggestion (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  rid_a TEXT NOT NULL,
  rid_b TEXT NOT NULL,
  score REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'ACCEPTED', 'REJECTED')),
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_og_merge_tenant ON og_merge_suggestion (tenant_id, status);

CREATE TABLE og_object_set (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  definition TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ix_og_object_set_tenant ON og_object_set (tenant_id);

-- Audit of executed actions. Never deleted.
CREATE TABLE og_action_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  target_rid TEXT NOT NULL,
  params TEXT,
  before TEXT,
  after TEXT,
  actor TEXT NOT NULL,
  recommendation_id TEXT,
  writeback_status TEXT NOT NULL DEFAULT 'NONE',
  writeback_attempts INTEGER NOT NULL DEFAULT 0,
  executed_at INTEGER NOT NULL
);
CREATE INDEX ix_og_action_target ON og_action_log (tenant_id, target_rid, executed_at);
CREATE INDEX ix_og_action_writeback ON og_action_log (writeback_status);

-- Outbox: written in the same batch() as the data it describes.
CREATE TABLE domain_event (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  type TEXT NOT NULL,
  -- Target queue: graph-sync | situation-events.
  topic TEXT NOT NULL,
  payload TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  dispatched_at INTEGER
);
CREATE INDEX ix_outbox_pending ON domain_event (dispatched_at) WHERE dispatched_at IS NULL;

-- Idempotency for queue messages (jobId:seq).
CREATE TABLE og_inbox (
  msg_key TEXT PRIMARY KEY,
  processed_at INTEGER NOT NULL
);

-- Per-tenant metadata (e.g. last indexed model version).
CREATE TABLE og_meta (
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (tenant_id, key)
);
