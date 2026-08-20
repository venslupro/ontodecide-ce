/**
 * Environment bindings for the User Service.
 */
import type {BaseEnv} from '@ontodecide/shared';

export interface UserEnv extends BaseEnv {
  /** D1 database holding users, audit_logs, system_config, refresh_tokens. */
  DB: D1Database;
  /** KV cache namespace. */
  CACHE: KVNamespace;
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
  created_by: string | null;
  created_at: string;
  last_login_at: string | null;
  last_cleanup_at: string | null;
  data_retention_days: number;
  data_size_estimate: number;
  metadata: string | null;
}
