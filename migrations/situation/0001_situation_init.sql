-- situation-awareness-db: KPIs, metrics, automations, alerts, layouts, DLQ.
CREATE TABLE sit_kpi (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  object_set TEXT NOT NULL,
  aggregate TEXT NOT NULL,
  unit TEXT,
  target REAL,
  higher_is_better INTEGER NOT NULL DEFAULT 1,
  value REAL,
  updated_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_sit_kpi_tenant ON sit_kpi (tenant_id);

-- 5-minute granularity, 90-day TTL.
CREATE TABLE sit_metric_point (
  tenant_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  ts INTEGER NOT NULL,
  value REAL NOT NULL,
  PRIMARY KEY (tenant_id, metric, ts)
);

CREATE TABLE sit_automation (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  trigger TEXT NOT NULL,
  condition TEXT,
  effect TEXT NOT NULL,
  severity TEXT NOT NULL,
  cooldown_sec INTEGER NOT NULL DEFAULT 3600,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_fired_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_sit_automation_tenant ON sit_automation (tenant_id, enabled);

CREATE TABLE sit_alert (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  automation_id TEXT NOT NULL,
  rid TEXT,
  title TEXT,
  severity TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'ACKED', 'CLOSED')),
  snapshot TEXT,
  hits INTEGER NOT NULL DEFAULT 1,
  acked_by TEXT,
  recommendation_id TEXT,
  raised_at INTEGER NOT NULL,
  closed_at INTEGER
);
-- At most one OPEN alert per (automation, object).
CREATE UNIQUE INDEX ux_alert_open ON sit_alert (automation_id, rid) WHERE status = 'OPEN';
CREATE INDEX ix_sit_alert_tenant ON sit_alert (tenant_id, status, raised_at);

-- Recommendation summaries pushed by decision-engine (cockpit list).
CREATE TABLE sit_recommendation (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ix_sit_rec_tenant ON sit_recommendation (tenant_id, status, updated_at);

CREATE TABLE sit_layout (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  layout TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

-- Dead letters from every *-dlq queue.
CREATE TABLE sit_dead_letter (
  id TEXT PRIMARY KEY,
  queue TEXT NOT NULL,
  body TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  replayed_at INTEGER
);
CREATE INDEX ix_sit_dlq_queue ON sit_dead_letter (queue, replayed_at);

-- Processed situation-events (idempotency by eventId).
CREATE TABLE sit_processed_event (
  event_id TEXT PRIMARY KEY,
  processed_at INTEGER NOT NULL
);

-- Daily usage snapshots written by UsageGuard.
CREATE TABLE sit_usage_day (
  day TEXT NOT NULL,
  resource TEXT NOT NULL,
  used REAL NOT NULL,
  PRIMARY KEY (day, resource)
);
