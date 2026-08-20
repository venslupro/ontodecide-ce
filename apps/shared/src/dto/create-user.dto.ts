/**
 * DTO for `POST /api/admin/users`.
 *
 * Validation rules are intentionally simple; deep schema validation is the
 * responsibility of each service's handler (or a zod schema if added later).
 */
import type {UserRole} from '../types/user.js';

export interface CreateUserDto {
  /** Unique username (3-32 chars, alphanumeric, dot, underscore, dash). */
  username: string;
  /** Role assigned to the new user. Defaults to 'analyst'. */
  role?: UserRole;
  /** Optional contact email. */
  email?: string;
  /** Optional override of the global data-retention window in days. */
  dataRetentionDays?: number;
}
