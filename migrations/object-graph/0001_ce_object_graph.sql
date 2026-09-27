-- object-graph-db (CE V2.4; 详细设计 6.2, 6.11.3). Primary keys start with
-- tenant_id; the three large tables are WITHOUT ROWID to limit write
-- amplification (every index row counts as a D1 row written).
DROP TABLE IF EXISTS og_inbox;
DROP TABLE IF EXISTS og_meta;
DROP TABLE IF EXISTS og_object_alias;
DROP TABLE IF EXISTS og_merge_suggestion;
DROP TABLE IF EXISTS og_object_set;
DROP TABLE IF EXISTS og_action_log;
DROP TABLE IF EXISTS domain_event;
DROP TABLE IF EXISTS og_prop_index;
DROP TABLE IF EXISTS og_link;
DROP TABLE IF EXISTS og_object;

CREATE TABLE og_object (
  tenant_id   TEXT NOT NULL,
  -- ri.<type>.<ulid>
  rid         TEXT NOT NULL,
  object_type TEXT NOT NULL,
  primary_key TEXT NOT NULL,
  title       TEXT,
  -- JSON property values.
  props       TEXT NOT NULL,
  -- SHA-256 of canonical props; unchanged rows are not rewritten.
  props_hash  TEXT NOT NULL,
  -- JSON {prop: {jobId, row, at}}.
  provenance  TEXT NOT NULL,
  -- ETag source ("v{version}").
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, rid),
  UNIQUE (tenant_id, object_type, primary_key)
) WITHOUT ROWID;

-- Indexed properties only; numbers and strings share one value column.
CREATE TABLE og_prop_index (
  tenant_id   TEXT NOT NULL,
  rid         TEXT NOT NULL,
  prop        TEXT NOT NULL,
  object_type TEXT NOT NULL,
  value       ANY,
  PRIMARY KEY (tenant_id, rid, prop)
) WITHOUT ROWID;
CREATE INDEX ix_prop_value ON og_prop_index (tenant_id, object_type, prop, value);

-- The primary key doubles as the outgoing-edge index.
CREATE TABLE og_link (
  tenant_id TEXT NOT NULL,
  src_rid   TEXT NOT NULL,
  link_type TEXT NOT NULL,
  dst_rid   TEXT NOT NULL,
  weight    REAL,
  props     TEXT,
  PRIMARY KEY (tenant_id, src_rid, link_type, dst_rid)
) WITHOUT ROWID;
CREATE INDEX ix_link_dst ON og_link (tenant_id, dst_rid);

-- Business audit of executed actions (exported as audit.jsonl).
CREATE TABLE og_action_log (
  tenant_id         TEXT NOT NULL,
  id                TEXT NOT NULL,
  action_type       TEXT NOT NULL,
  target_rid        TEXT NOT NULL,
  params            TEXT,
  before            TEXT,
  after             TEXT,
  actor             TEXT NOT NULL CHECK (actor IN ('owner', 'admin', 'svc:decision-engine')),
  actor_user_id     TEXT,
  recommendation_id TEXT,
  -- The idempotency key lives on the business row; no separate table.
  idempotency_key   TEXT NOT NULL,
  result            TEXT NOT NULL,
  executed_at       INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX ix_action_target ON og_action_log (tenant_id, target_rid, executed_at);

-- Outbox: one aggregated row per commit, deleted once delivered.
CREATE TABLE domain_event (
  tenant_id   TEXT NOT NULL,
  id          TEXT NOT NULL,
  payload     TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX ix_outbox_age ON domain_event (occurred_at);

CREATE TABLE tenant_tombstone (
  tenant_id  TEXT PRIMARY KEY,
  deleted_at INTEGER NOT NULL
);
