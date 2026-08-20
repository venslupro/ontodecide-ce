/**
 * Profile handlers (self-service, non-admin).
 *
 *   GET /user/profile  — current user's snapshot
 */
import type {Context} from 'hono';
import {ERROR_CODES, HEADERS, fail, ok} from '@ontodecide/shared';
import type {UserManagementService} from '../service/user.service.js';

/** GET /user/profile */
export async function profileHandler(
    c: Context,
    service: UserManagementService,
) {
  const userId = c.req.header(HEADERS.USER_ID);
  if (!userId) {
    return c.json(
        fail(ERROR_CODES.AUTH_FORBIDDEN, 'Missing identity headers.'),
        403,
    );
  }
  const user = await service.getUser(userId);
  return c.json(ok(user.snapshot(), c.req.header(HEADERS.TRACE_ID)), 200);
}
