-- Tenant of each dead letter (from body.tenantId or body.ctx.tenantId) so
-- the admin DLQ page is tenant-scoped; NULL when the body carries none.
ALTER TABLE sit_dead_letter ADD COLUMN tenant_id TEXT;
CREATE INDEX ix_sit_dlq_tenant ON sit_dead_letter (tenant_id, queue, replayed_at);
