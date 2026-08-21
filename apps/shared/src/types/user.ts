/**
 * User domain types shared between Gateway, User, AI and Cleanup services.
 */

/** Role assigned to a user; gates what admin endpoints they can call. */
export type UserRole = 'admin' | 'analyst' | 'viewer';

/** Lifecycle state derived from `is_active` / `is_data_cleared` flags. */
export type UserState = 'pending' | 'active' | 'disabled' | 'data_cleared';

/** JWT payload signed by the Gateway Worker. */
export interface JwtPayload {
  /** Subject (user id). */
  user_id: string;
  /** Tenant isolation id, format `tenant_xxxx`. */
  tenant_id: string;
  /** Login username. */
  username: string;
  /** Authorization role. */
  role: UserRole;
  /** Expiry epoch seconds. */
  exp: number;
  /** Issued-at epoch seconds. */
  iat: number;
  /** JWT id (for revocation via KV blacklist). */
  jti: string;
  /** When true, the caller may only access /auth/change-password. */
  pwd_change_required?: boolean;
}

/** Public user record returned to clients (never contains password_hash). */
export interface UserPublic {
  id: string;
  tenant_id: string;
  username: string;
  email: string | null;
  role: UserRole;
  is_active: boolean;
  is_data_cleared: boolean;
  must_change_password: boolean;
  expires_at: string | null;
  created_at: string;
  last_login_at: string | null;
  last_cleanup_at: string | null;
  data_retention_days: number;
  data_size_estimate: number;
}

/** Persisted user row in D1 (includes sensitive fields). */
export interface UserRow extends UserPublic {
  password_hash: string;
  created_by: string | null;
  metadata: string | null;
}

/** Audit log row in D1. */
export interface AuditLogRow {
  id: string;
  tenant_id: string;
  operator_id: string;
  action: AuditAction;
  target_user_id: string | null;
  details: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

/** Actions recorded in `audit_logs`. */
export type AuditAction =
  | 'create_user'
  | 'disable_user'
  | 'enable_user'
  | 'reset_password'
  | 'change_password'
  | 'cleanup_data'
  | 'login'
  | 'logout'
  | 'delete_user';

/** Result returned when an admin creates or resets a user. */
export interface CredentialResult {
  id: string;
  tenant_id: string;
  username: string;
  /** Plaintext password, only visible at creation/reset time. */
  temporary_password: string;
}
