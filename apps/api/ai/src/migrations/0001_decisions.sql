-- ============================================================
-- Migration 0001: AI-domain tables (decisions, recommendations).
--
-- The AI Service persists every decision/recommendation it produces so
-- that the dashboard can render history and the budget manager can
-- reason over past runs.
-- ============================================================

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('scenario', 'recommendation', 'agent_plan')),
  topic TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  prompt_hash TEXT NOT NULL,
  payload TEXT NOT NULL,
  neuron_cost INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_decisions_tenant ON decisions(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_decisions_prompt ON decisions(tenant_id, prompt_hash);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('idle', 'planning', 'executing', 'reflecting', 'done', 'failed')),
  task_count INTEGER NOT NULL DEFAULT 0,
  completed_count INTEGER NOT NULL DEFAULT 0,
  provider TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  result TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant ON agent_runs(tenant_id, started_at);
