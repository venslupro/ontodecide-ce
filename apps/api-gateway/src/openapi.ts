/**
 * @fileoverview OpenAPI 3.1 document generated from the route table and the
 * contracts' zod schemas.
 */

import {ERROR_STATUS} from '@ontodecide/shared-kernel';
import {z} from 'zod';
import {compilePattern} from './router';
import type {AnyRoute} from './route_types';

type JsonSchema = Record<string, unknown>;

function toSchema(schema: z.ZodType): JsonSchema {
  try {
    const out = z.toJSONSchema(schema, {
      io: 'input',
      unrepresentable: 'any',
      target: 'draft-2020-12',
    }) as JsonSchema;
    delete out.$schema;
    return out;
  } catch {
    return {};
  }
}

/** `/users/:id/password:reset` → `/users/{id}/password:reset`. */
export function toOpenApiPath(path: string): string {
  return (
    '/' +
    compilePattern(path)
      .map(s => (s.kind === 'param' ? `{${s.name}}` : s.value))
      .join('/')
  );
}

function operationId(r: AnyRoute): string {
  const words = compilePattern(r.path).flatMap(s =>
    s.kind === 'param'
      ? ['by', s.name]
      : s.value.split(/[^A-Za-z0-9]+/).filter(Boolean),
  );
  const camel = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  return r.method.toLowerCase() + camel;
}

function queryParameters(r: AnyRoute): JsonSchema[] {
  const q = r.query as z.ZodType | undefined;
  if (!q || !(q instanceof z.ZodObject)) return [];
  return Object.entries(q.shape as Record<string, z.ZodType>).map(
    ([name, field]) => ({
      name,
      in: 'query',
      required: !field.safeParse(undefined).success,
      schema: toSchema(field),
    }),
  );
}

const PROBLEM_SCHEMA: JsonSchema = {
  type: 'object',
  required: ['type', 'title', 'status', 'code'],
  properties: {
    type: {type: 'string', format: 'uri'},
    title: {type: 'string'},
    status: {type: 'integer'},
    code: {type: 'string', enum: Object.keys(ERROR_STATUS)},
    detail: {type: 'string'},
    requestId: {type: 'string'},
    errors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {path: {type: 'string'}, message: {type: 'string'}},
      },
    },
  },
  additionalProperties: true,
};

const problemRef = {
  content: {
    'application/problem+json': {
      schema: {$ref: '#/components/schemas/Problem'},
    },
  },
};

function operation(r: AnyRoute): JsonSchema {
  const params: JsonSchema[] = compilePattern(r.path)
    .filter(s => s.kind === 'param')
    .map(s => ({
      name: (s as {name: string}).name,
      in: 'path',
      required: true,
      schema: {type: 'string'},
    }));
  params.push(...queryParameters(r));
  if (r.idempotent) {
    params.push({
      name: 'Idempotency-Key',
      in: 'header',
      required: false,
      schema: {type: 'string', maxLength: 128},
    });
  }
  const status = String(r.status ?? 200);
  const responses: JsonSchema = {
    [status]:
      status === '204'
        ? {description: 'No content'}
        : {
            description: 'Success',
            content: {'application/json': {schema: {}}},
          },
    default: {description: 'Problem Details', ...problemRef},
  };
  if (r.websocket) responses['101'] = {description: 'Switching Protocols'};
  const op: JsonSchema = {
    operationId: operationId(r),
    summary: r.summary,
    tags: [r.service],
    parameters: params,
    responses,
    'x-min-role': r.minRole,
    ...(r.rateGroup ? {'x-rate-group': r.rateGroup} : {}),
  };
  if (r.minRole === 'public' || r.minRole === 'hmac') op.security = [];
  else if (r.minRole === 'cookie') op.security = [{refreshCookie: []}];
  if (r.body) {
    op.requestBody = {
      required: !(r.body as z.ZodType).safeParse(undefined).success,
      content: {'application/json': {schema: toSchema(r.body as z.ZodType)}},
    };
  } else if (r.minRole === 'hmac') {
    op.requestBody = {
      required: true,
      content: {'application/json': {schema: {}}},
    };
  }
  return op;
}

/** Builds the OpenAPI 3.1 document. */
export function buildOpenApi(routes: AnyRoute[], version: string): JsonSchema {
  const paths: Record<string, JsonSchema> = {};
  for (const r of routes) {
    const p = toOpenApiPath(r.path);
    paths[p] ??= {};
    paths[p][r.method.toLowerCase()] = operation(r);
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'OntoDecide CE API',
      version,
      description:
        'Public REST API served by api-gateway. Errors are RFC 9457 Problem Details.',
    },
    servers: [{url: '/api/v1'}],
    security: [{bearerAuth: []}],
    tags: [...new Set(routes.map(r => r.service))].map(name => ({name})),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {type: 'http', scheme: 'bearer', bearerFormat: 'JWT'},
        refreshCookie: {type: 'apiKey', in: 'cookie', name: 'od_refresh'},
      },
      schemas: {Problem: PROBLEM_SCHEMA},
    },
  };
}
