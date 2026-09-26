/**
 * @fileoverview Bindings of the identity-access Worker.
 */

/** identity-access environment. */
export interface Env {
  IDENTITY_DB: D1Database;
  /** Secret: `kid:secret[,kid:secret]`; first entry signs. */
  JWT_SECRET: string;
  BOOTSTRAP_ADMIN_EMAIL?: string;
  /** Secret. */
  BOOTSTRAP_ADMIN_PASSWORD?: string;
  BOOTSTRAP_TENANT_NAME?: string;
  ENVIRONMENT?: string;
}
