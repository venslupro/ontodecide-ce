/**
 * Admin-only user management handlers (see design doc §4.2.4).
 *
 *   GET    /admin/users                — paginated list
 *   POST   /admin/users                — create user, returns temp password
 *   PUT    /admin/users/:id/status     — enable/disable
 *   POST   /admin/users/:id/reset      — reset password
 *   DELETE /admin/users/:id            — delete (soft)
 *   GET    /admin/audit                 — audit log for the tenant
 *   GET    /admin/config                — list system config
 *   PUT    /admin/config                — set system config value
 */
import type { Context } from 'hono';
import { ERROR_CODES, HEADERS, fail, ok } from '@ontodecide/shared';
import type { UserManagementService } from '../service/user.service.js';
import type { AuditContext } from '../service/user.service.js';

/** GET /admin/users?page=1&size=20&role=analyst */
export async function listUsersHandler(c: Context, service: UserManagementService) {
  const page = parseInt(c.req.query('page') ?? '1', 10);
  const size = parseInt(c.req.query('size') ?? '50', 10);
  const role = c.req.query('role') ?? undefined;
  const { total, items } = await service.listUsers({ page, size, role });
  return c.json(ok({ total, page, size, list: items }, c.req.header(HEADERS.TRACE_ID)), 200);
}

/** POST /admin/users */
export async function createUserHandler(c: Context, service: UserManagementService) {
  const dto = await c.req.json();
  const ctx = auditContext(c);
  const { user, temporaryPassword } = await service.createUser(dto, ctx);
  return c.json(
    ok(
      {
        id: user.id,
        tenant_id: user.tenantId,
        username: user.username,
        temporary_password: temporaryPassword,
      },
      c.req.header(HEADERS.TRACE_ID),
    ),
    201,
  );
}

/** PUT /admin/users/:id/status  body: { is_active: boolean } */
export async function updateStatusHandler(c: Context, id: string, service: UserManagementService) {
  const body = await c.req.json();
  if (body?.is_active === undefined) {
    return c.json(fail(ERROR_CODES.VALIDATION_FAILED, 'is_active is required.'), 400);
  }
  const user = await service.setStatus(id, body.is_active, auditContext(c));
  return c.json(ok(user.snapshot(), c.req.header(HEADERS.TRACE_ID)), 200);
}

/** POST /admin/users/:id/reset */
export async function resetPasswordHandler(c: Context, id: string, service: UserManagementService) {
  const temporaryPassword = await service.resetPassword(id, auditContext(c));
  return c.json(ok({ temporary_password: temporaryPassword }, c.req.header(HEADERS.TRACE_ID)), 200);
}

/** DELETE /admin/users/:id */
export async function deleteUserHandler(c: Context, id: string, service: UserManagementService) {
  await service.deleteUser(id, auditContext(c));
  return c.json(ok({ success: true }, c.req.header(HEADERS.TRACE_ID)), 200);
}

/** GET /admin/audit?page=1&size=50 */
export async function listAuditHandler(c: Context, service: UserManagementService) {
  const tenantId = c.req.header(HEADERS.TENANT_ID);
  if (!tenantId) {
    return c.json(fail(ERROR_CODES.AUTH_FORBIDDEN, 'Missing tenant id.'), 403);
  }
  const page = parseInt(c.req.query('page') ?? '1', 10);
  const size = parseInt(c.req.query('size') ?? '50', 10);
  const { total, items } = await service.listAudit(tenantId, { page, size });
  return c.json(ok({ total, page, size, list: items }, c.req.header(HEADERS.TRACE_ID)), 200);
}

/** GET /admin/config */
export async function listConfigHandler(c: Context, service: UserManagementService) {
  return c.json(ok(await service.getAllConfig(), c.req.header(HEADERS.TRACE_ID)), 200);
}

/** PUT /admin/config  body: { key: string, value: string } */
export async function setConfigHandler(c: Context, service: UserManagementService) {
  const body = await c.req.json();
  if (!body?.key || body.value === undefined) {
    return c.json(fail(ERROR_CODES.VALIDATION_FAILED, 'key and value are required.'), 400);
  }
  await service.setConfig(body.key, body.value, auditContext(c));
  return c.json(ok({ success: true }, c.req.header(HEADERS.TRACE_ID)), 200);
}

/** Build the audit context from identity headers injected by the Gateway. */
function auditContext(c: Context): AuditContext {
  return {
    operatorId: c.req.header(HEADERS.USER_ID) ?? 'anon',
    operatorTenantId: c.req.header(HEADERS.TENANT_ID) ?? 'tenant_anon',
    ip: c.req.header('cf-connecting-ip') ?? null,
    userAgent: c.req.header('user-agent') ?? null,
  };
}
