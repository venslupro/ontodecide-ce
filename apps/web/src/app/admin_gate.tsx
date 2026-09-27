/**
 * @fileoverview /admin gate: the platform page for role admin, the 403
 * page for everyone else (the gateway enforces the role on /admin/*).
 */

import {useSession} from '../entities/session/store';
import {AdminPage} from '../pages/admin/admin_page';
import {ForbiddenPage} from './forbidden_page';

/** Renders the platform page or 403. */
export function AdminGate() {
  const isAdmin = useSession(s => s.role === 'admin');
  return isAdmin ? <AdminPage /> : <ForbiddenPage />;
}
