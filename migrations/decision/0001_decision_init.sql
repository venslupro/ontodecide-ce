-- decision-engine-db: scenarios, recommendations, LLM cache and usage.
CREATE TABLE dec_scenario (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  perturbations TEXT NOT NULL,
  result TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_dec_scenario_tenant ON dec_scenario (tenant_id, created_at);

CREATE TABLE dec_recommendation (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  alert_id TEXT,
  scenario_id TEXT,
  focus TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT,
  rationale TEXT,
  actions TEXT,
  evidence TEXT,
  risks TEXT,
  confidence REAL,
  model TEXT,
  degraded INTEGER NOT NULL DEFAULT 0,
  simulation TEXT,
  locale TEXT NOT NULL DEFAULT 'zh-CN',
  requested_by TEXT,
  approved_by TEXT,
  decided_at INTEGER,
  reject_reason TEXT,
  feedback TEXT,
  outcome TEXT,
  executed_at INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX ix_dec_rec_tenant ON dec_recommendation (tenant_id, status, created_at);
CREATE INDEX ix_dec_rec_status ON dec_recommendation (status, executed_at);

CREATE TABLE dec_llm_cache (
  input_hash TEXT PRIMARY KEY,
  output TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE dec_llm_usage (
  day TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  model TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  neurons INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, tenant_id, user_id, model)
);

-- Evaluated cases for RAG. Vectorize holds embeddings in production; the
-- embedding column is the free-tier fallback (brute-force cosine search).
CREATE TABLE dec_case (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  outcome TEXT,
  embedding TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_dec_case_tenant ON dec_case (tenant_id, created_at);
