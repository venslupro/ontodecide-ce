/**
 * @fileoverview Problem Details responses for MSW handlers.
 */

import type {ErrorCode, Problem} from '@ontodecide/shared-kernel';
import {HttpResponse} from 'msw';

/** MSW base for the gateway. */
export const API = '*/api/v1';

/** Builds a Problem Details response. */
export function problem(
  status: number,
  code: ErrorCode,
  detail?: string,
  extras: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  const body: Problem = {
    type: `about:blank#${code.toLowerCase()}`,
    title: code,
    status,
    code,
    ...(detail ? {detail} : {}),
    traceId: 'trace-test',
    ...extras,
  };
  return HttpResponse.json(body, {
    status,
    headers: {'content-type': 'application/problem+json', ...headers},
  });
}
