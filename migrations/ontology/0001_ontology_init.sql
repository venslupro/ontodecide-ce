-- ontology-manager-db: schema versions (immutable once published) and packs.
CREATE TABLE ont_schema (
  tenant_id TEXT NOT NULL,
  api_name TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'DEPRECATED')),
  definition TEXT NOT NULL,
  compiled TEXT,
  published_by TEXT,
  published_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, api_name, version)
);
CREATE INDEX ix_ont_schema_status ON ont_schema (tenant_id, status);

CREATE TABLE ont_pack (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  manifest TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
