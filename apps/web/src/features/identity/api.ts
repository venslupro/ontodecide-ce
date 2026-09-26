/**
 * @fileoverview Identity queries & mutations: login/logout/session restore,
 * profile and user administration.
 */

import type {UserDto} from '@ontodecide/identity/contract';
import type {Role} from '@ontodecide/shared-kernel';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {toSessionUser, useSession} from '../../entities/session/store';
import {api, asList, refreshAccessToken} from '../../shared/api/client';
import {qk} from '../../shared/api/query_keys';

/** Login response body (the refresh token is set as an HttpOnly cookie). */
export interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  user: UserDto;
}

/** Password login; stores the grant in the session. */
export async function login(
  email: string,
  password: string,
): Promise<LoginResponse> {
  const res = await api.post<LoginResponse>(
    '/auth/login',
    {email, password},
    {auth: false, retryOn401: false},
  );
  useSession.getState().setGrant(res);
  return res;
}

/** Logs out (clears the cookie server-side) and resets the session. */
export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout', undefined, {retryOn401: false});
  } finally {
    useSession.getState().signOut();
  }
}

/**
 * Restores a session on app start using the refresh cookie. Returns true
 * when signed in.
 */
export async function restoreSession(): Promise<boolean> {
  const ok = await refreshAccessToken();
  if (!ok) {
    useSession.getState().signOut();
    return false;
  }
  if (!useSession.getState().user) {
    try {
      const me = await api.get<UserDto>('/me');
      useSession.getState().setUser(me);
    } catch {
      useSession.getState().signOut();
      return false;
    }
  }
  return true;
}

/** Current user profile. */
export function useMe() {
  return useQuery({queryKey: qk.me(), queryFn: () => api.get<UserDto>('/me')});
}

/** Updates the profile (name / locale). */
export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: {name?: string; locale?: string}) =>
      api.patch<UserDto>('/me', patch),
    onSuccess: u => {
      qc.setQueryData(qk.me(), u);
      useSession.getState().setUser(toSessionUser(u));
    },
  });
}

/** Changes the caller's password. */
export function useChangePassword() {
  return useMutation({
    mutationFn: (input: {currentPassword: string; newPassword: string}) =>
      api.post<void>('/me/password', input),
  });
}

/** All users (Admin). */
export function useUsers() {
  return useQuery({
    queryKey: qk.users(),
    queryFn: async () => asList(await api.get<UserDto[]>('/users')),
  });
}

/** Creates a user; the temporary password is returned once. */
export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      email: string;
      name: string;
      role: Role;
      markings?: string[];
      password?: string;
    }) =>
      api.post<{user: UserDto; temporaryPassword?: string}>('/users', input),
    onSuccess: () => qc.invalidateQueries({queryKey: qk.users()}),
  });
}

/** Updates name / role / disabled. */
export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: {name?: string; role?: Role; disabled?: boolean};
    }) => api.patch<UserDto>(`/users/${encodeURIComponent(id)}`, patch),
    onSuccess: () => qc.invalidateQueries({queryKey: qk.users()}),
  });
}

/** Replaces a user's markings. */
export function useGrantMarkings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({id, markings}: {id: string; markings: string[]}) =>
      api.post<UserDto>(`/users/${encodeURIComponent(id)}/markings`, {
        markings,
      }),
    onSuccess: () => qc.invalidateQueries({queryKey: qk.users()}),
  });
}

/** Admin password reset; returns a temporary password. */
export function useResetPassword() {
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{temporaryPassword: string}>(
        `/users/${encodeURIComponent(id)}/password:reset`,
      ),
  });
}

/** Deletes a user. */
export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/users/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({queryKey: qk.users()}),
  });
}
