/**
 * Public account-application handler.
 *
 *   POST /applications  — submit an account request with email + usage days.
 *
 * The email is used as the login username. Internally, an immutable
 * tenant_id (data anchor) is generated and stored alongside the email
 * — all databases, KV keys, and B2 paths reference the tenant_id, so
 * the email can be changed later without migrating data.
 *
 * Sends the credentials + expiration time via email. This endpoint is
 * public (no auth required) but rate-limited at the Gateway.
 */
import type { Context } from 'hono';
import { ERROR_CODES, HEADERS, fail, ok } from '@ontodecide/shared';
import type { UserManagementService } from '../service/user.service.js';
import type { AuditContext } from '../service/user.service.js';

/** POST /applications */
export async function submitApplicationHandler(c: Context, service: UserManagementService) {
  const body = await c.req.json();
  if (!body?.email || !body?.usageDays) {
    return c.json(fail(ERROR_CODES.VALIDATION_FAILED, 'email and usageDays are required.'), 400);
  }
  const usageDays = parseInt(body.usageDays, 10);
  if (isNaN(usageDays) || usageDays < 1 || usageDays > 90) {
    return c.json(
      fail(ERROR_CODES.VALIDATION_FAILED, 'usageDays must be an integer between 1 and 90.'),
      400,
    );
  }
  const ctx: AuditContext = {
    operatorId: 'public',
    operatorTenantId: 'tenant_public',
    ip: c.req.header('cf-connecting-ip') ?? null,
    userAgent: c.req.header('user-agent') ?? null,
  };
  const { user, temporaryPassword, emailSent } = await service.submitApplication(
    body.email,
    usageDays,
    ctx,
  );

  return c.json(
    ok(
      {
        id: user.id,
        username: user.username,
        expires_at: user.expiresAt,
        email_sent: emailSent,
        // When email is not configured (local dev), return the temp
        // password in the response so the applicant can still log in.
        temporary_password: emailSent ? undefined : temporaryPassword,
      },
      c.req.header(HEADERS.TRACE_ID),
    ),
    201,
  );
}
