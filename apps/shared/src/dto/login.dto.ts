/**
 * DTO for `POST /api/auth/login`.
 */
export interface LoginDto {
  username: string;
  password: string;
}

/** DTO for `POST /api/auth/refresh`. */
export interface RefreshDto {
  refreshToken: string;
}

/** Tokens returned by login / refresh. */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Access token expiry epoch seconds. */
  expiresIn: number;
}
