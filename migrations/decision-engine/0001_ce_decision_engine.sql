-- decision-engine-db (CE V2.4; 详细设计 6.2, 6.11.5). No AI cache and no
-- rule-ranking counters (removed in V2.4).
DROP TABLE IF EXISTS dec_llm_cache;
DROP TABLE IF EXISTS dec_llm_usage;
DROP TABLE IF EXISTS dec_case;
DROP TABLE IF EXISTS dec_recommendation;
DROP TABLE IF EXISTS dec_scenario;

CREATE TABLE dec_scenario (
  tenant_id     TEXT NOT NULL,
  id            TEXT NOT NULL,
  name          TEXT,
  perturbations TEXT NOT NULL,
  candidates    TEXT,
  result        TEXT,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE dec_recommendation (
  tenant_id     TEXT NOT NULL,
  id            TEXT NOT NULL,
  focus         TEXT NOT NULL,
  alert_id      TEXT,
  scenario_id   TEXT,
  status        TEXT NOT NULL CHECK (status IN
                  ('Proposed', 'Confirmed', 'Rejected', 'Expired', 'Executed', 'ExecFailed')),
  summary       TEXT,
  rationale     TEXT,
  locale        TEXT,
  -- Deterministic candidates with fixed params; the model cannot edit them.
  candidates    TEXT NOT NULL,
  -- Candidate ids in ranked order (from AI or rules).
  ranking       TEXT NOT NULL,
  evidence      TEXT,
  risks         TEXT,
  simulation    TEXT,
  confidence    REAL,
  ranked_by     TEXT NOT NULL CHECK (ranked_by IN ('ai', 'rules')),
  model         TEXT,
  -- Idempotency-Key of the confirm / reject request.
  decision_key  TEXT,
  decided_by    TEXT CHECK (decided_by IN ('owner', 'admin')),
  decided_at    INTEGER,
  reject_reason TEXT,
  execution     TEXT,
  exec_attempts INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, decision_key)
);
CREATE INDEX ix_rec_status ON dec_recommendation (tenant_id, status, created_at);

-- scope: '{tid}:{sub}' for rec_ai (per-user cap), '*' for the Neurons budget.
CREATE TABLE dec_usage (
  day   TEXT NOT NULL,
  scope TEXT NOT NULL,
  key   TEXT NOT NULL CHECK (key IN ('rec_ai', 'neurons')),
  value INTEGER NOT NULL,
  PRIMARY KEY (day, scope, key)
);

CREATE TABLE tenant_tombstone (
  tenant_id  TEXT PRIMARY KEY,
  deleted_at INTEGER NOT NULL
);
