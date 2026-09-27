-- ontology-manager-db (CE V2.4; 详细设计 6.2, 6.11.1).
-- Shared read-only templates plus one copy-on-write schema per workspace.
-- Single version: no drafts, publishing or rollback.
DROP TABLE IF EXISTS ont_schema;
DROP TABLE IF EXISTS ont_pack;

-- Shared read-only template ("supply chain risk"); seeded from code by
-- ontology-manager on first use. Contains no workspace data.
CREATE TABLE ont_template (
  template_id     TEXT NOT NULL,
  version         TEXT NOT NULL,
  definition      TEXT NOT NULL,
  compiled        TEXT NOT NULL,
  -- Seeds situation-awareness installs on first cockpit open.
  kpi_seed        TEXT,
  automation_seed TEXT,
  PRIMARY KEY (template_id, version)
);

-- Created by copy-on-write on the first ontology change of a workspace.
CREATE TABLE ont_workspace_schema (
  tenant_id        TEXT PRIMARY KEY,
  template_id      TEXT NOT NULL,
  template_version TEXT NOT NULL,
  definition       TEXT NOT NULL,
  compiled         TEXT NOT NULL,
  etag             INTEGER NOT NULL DEFAULT 1,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE tenant_tombstone (
  tenant_id  TEXT PRIMARY KEY,
  deleted_at INTEGER NOT NULL
);
