/**
 * @fileoverview RPC handler object implementing {@link IdentityRpc}. Errors
 * leave as {@link AppError} (which survives RPC); unexpected errors are
 * logged and replaced by INTERNAL so no internals leak to callers.
 */

import {AppError} from '@ontodecide/shared-kernel';
import {
  ChangePasswordHandler,
  CreateUserHandler,
  DeleteUserHandler,
  GrantMarkingHandler,
  ListUsersHandler,
  LoginHandler,
  LogoutHandler,
  MeHandler,
  RefreshHandler,
  ResetPasswordHandler,
  UpdateMeHandler,
  UpdateUserHandler,
  type IdentityDeps,
} from '../application';
import type {IdentityRpc} from '../contract';

/** Builds the identity RPC surface from the application dependencies. */
export function createIdentityRpc(deps: IdentityDeps): IdentityRpc {
  const login = new LoginHandler(deps);
  const refresh = new RefreshHandler(deps);
  const logout = new LogoutHandler(deps);
  const me = new MeHandler(deps);
  const updateMe = new UpdateMeHandler(deps);
  const changePassword = new ChangePasswordHandler(deps);
  const listUsers = new ListUsersHandler(deps);
  const createUser = new CreateUserHandler(deps);
  const updateUser = new UpdateUserHandler(deps);
  const grantMarking = new GrantMarkingHandler(deps);
  const resetPassword = new ResetPasswordHandler(deps);
  const deleteUser = new DeleteUserHandler(deps);

  const run = async <T>(method: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof AppError) throw e;
      deps.logger.error('identity.rpc_failed', {
        method,
        error: e instanceof Error ? e.message : String(e),
      });
      throw new AppError('INTERNAL', 'Internal error');
    }
  };

  return {
    login: input => run('login', () => login.execute(input)),
    refresh: token => run('refresh', () => refresh.execute(token)),
    logout: token => run('logout', () => logout.execute(token)),
    me: ctx => run('me', () => me.execute(ctx)),
    updateMe: (ctx, patch) =>
      run('updateMe', () => updateMe.execute(ctx, patch)),
    changePassword: (ctx, input) =>
      run('changePassword', () => changePassword.execute(ctx, input)),
    listUsers: ctx => run('listUsers', () => listUsers.execute(ctx)),
    createUser: (ctx, input) =>
      run('createUser', () => createUser.execute(ctx, input)),
    updateUser: (ctx, id, patch) =>
      run('updateUser', () => updateUser.execute(ctx, id, patch)),
    grantMarking: (ctx, userId, markings) =>
      run('grantMarking', () => grantMarking.execute(ctx, userId, markings)),
    resetPassword: (ctx, userId) =>
      run('resetPassword', () => resetPassword.execute(ctx, userId)),
    deleteUser: (ctx, userId) =>
      run('deleteUser', () => deleteUser.execute(ctx, userId)),
  };
}
