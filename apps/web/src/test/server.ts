/**
 * @fileoverview MSW node server with the default handlers.
 */

import {setupServer} from 'msw/node';
import {handlers} from './handlers';

/** Shared MSW server; tests override handlers with `server.use(...)`. */
export const server = setupServer(...handlers);
