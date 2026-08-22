/**
 * Environment bindings for the User Service.
 *
 * This Worker signs JWTs on login/refresh, so it holds {@link JwtEnv}.
 * It is the ONLY backend service besides the Gateway that needs access
 * to the signing secret — downstream services consume identity via
 * Gateway-injected headers.
 */
import type { BaseEnv, JwtEnv } from '@ontodecide/shared';

export interface UserEnv extends BaseEnv, JwtEnv {
  /** D1 database holding users, audit_logs, system_config, refresh_tokens. */
  DB: D1Database;
  /** KV cache namespace. */
  CACHE: KVNamespace;
  /** Resend (or compatible) API key for sending transactional emails. */
  EMAIL_API_KEY?: string;
  /** Sender email address for credential notifications. */
  EMAIL_FROM?: string;
}

/** Role assigned to a user; determines API permissions. */
export type UserRole = 'admin' | 'analyst' | 'viewer';

/** D1 row shape returned by SELECT * FROM users. */
export interface UserDbRow {
  id: string;
  tenant_id: string;
  username: string;
  password_hash: string;
  email: string | null;
  role: UserRole;
  is_active: 0 | 1;
  is_data_cleared: 0 | 1;
  must_change_password: 0 | 1;
  expires_at: string | null;
  created_by: string | null;
  created_at: string;
  last_login_at: string | null;
  last_cleanup_at: string | null;
  data_retention_days: number;
  data_size_estimate: number;
  metadata: string | null;
}
