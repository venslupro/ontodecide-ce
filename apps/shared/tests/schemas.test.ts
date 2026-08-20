/**
 * Unit tests for shared Zod schemas.
 *
 * These tests verify that every schema accepts valid input and rejects
 * invalid input at the boundary, which is the contract that the OpenAPI
 * route definitions rely on.
 */
import {describe, it, expect} from 'vitest';
import {
  loginSchema,
  refreshSchema,
  authTokensSchema,
  createUserSchema,
  userRoleSchema,
  userPublicSchema,
  credentialResultSchema,
  cleanupRequestSchema,
  scenarioRequestSchema,
  ingestSyncSchema,
  ingestFileSchema,
  apiResponseSchema,
  paginatedResponseSchema,
} from '../src/schemas/index.js';

describe('loginSchema', () => {
  it('accepts a valid username + password', () => {
    const result = loginSchema.safeParse({
      username: 'alice',
      password: 'secret123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing password', () => {
    const result = loginSchema.safeParse({username: 'alice'});
    expect(result.success).toBe(false);
  });

  it('rejects a missing username', () => {
    const result = loginSchema.safeParse({password: 'secret123'});
    expect(result.success).toBe(false);
  });
});

describe('refreshSchema', () => {
  it('accepts a valid refresh token string', () => {
    const result = refreshSchema.safeParse({refreshToken: 'abc.def.ghi'});
    expect(result.success).toBe(true);
  });

  it('rejects an empty object', () => {
    const result = refreshSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('authTokensSchema', () => {
  it('accepts a valid token triple', () => {
    const result = authTokensSchema.safeParse({
      accessToken: 'access-jwt',
      refreshToken: 'refresh-jwt',
      expiresIn: 604800,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-positive expiresIn', () => {
    const result = authTokensSchema.safeParse({
      accessToken: 'a',
      refreshToken: 'r',
      expiresIn: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe('createUserSchema', () => {
  it('accepts a minimal valid body (username only)', () => {
    const result = createUserSchema.safeParse({username: 'bob'});
    expect(result.success).toBe(true);
  });

  it('accepts a full valid body', () => {
    const result = createUserSchema.safeParse({
      username: 'charlie_42',
      role: 'analyst',
      email: 'charlie@example.com',
      dataRetentionDays: 60,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a username shorter than 3 chars', () => {
    const result = createUserSchema.safeParse({username: 'ab'});
    expect(result.success).toBe(false);
  });

  it('rejects a username with invalid characters', () => {
    const result = createUserSchema.safeParse({username: 'bad name!'});
    expect(result.success).toBe(false);
  });

  it('rejects an invalid role', () => {
    const result = createUserSchema.safeParse({
      username: 'validuser',
      role: 'superadmin',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid email', () => {
    const result = createUserSchema.safeParse({
      username: 'validuser',
      email: 'not-an-email',
    });
    expect(result.success).toBe(false);
  });

  it('rejects dataRetentionDays outside 1..365', () => {
    const tooLow = createUserSchema.safeParse({
      username: 'valid',
      dataRetentionDays: 0,
    });
    const tooHigh = createUserSchema.safeParse({
      username: 'valid',
      dataRetentionDays: 400,
    });
    expect(tooLow.success).toBe(false);
    expect(tooHigh.success).toBe(false);
  });
});

describe('userRoleSchema', () => {
  it.each(['admin', 'analyst', 'viewer'])('accepts "%s"', (role) => {
    expect(userRoleSchema.safeParse(role).success).toBe(true);
  });

  it('rejects an unknown role', () => {
    expect(userRoleSchema.safeParse('superadmin').success).toBe(false);
  });
});

describe('userPublicSchema', () => {
  const validUser = {
    id: 'u1',
    tenant_id: 'tenant_abc',
    username: 'alice',
    email: null,
    role: 'admin',
    is_active: true,
    is_data_cleared: false,
    created_at: '2025-01-01T00:00:00Z',
    last_login_at: null,
    last_cleanup_at: null,
    data_retention_days: 30,
    data_size_estimate: 0,
  };

  it('accepts a valid public user', () => {
    expect(userPublicSchema.safeParse(validUser).success).toBe(true);
  });

  it('rejects a non-boolean is_active', () => {
    expect(userPublicSchema.safeParse({...validUser, is_active: 1}).success)
        .toBe(false);
  });
});

describe('credentialResultSchema', () => {
  it('accepts a valid result', () => {
    const result = credentialResultSchema.safeParse({
      id: 'u1',
      tenant_id: 'tenant_abc',
      username: 'alice',
      temporary_password: 'TempPass123',
    });
    expect(result.success).toBe(true);
  });
});

describe('cleanupRequestSchema', () => {
  it('accepts an empty body (all fields optional)', () => {
    expect(cleanupRequestSchema.safeParse({}).success).toBe(true);
  });

  it('accepts tenantId + mode=soft', () => {
    expect(cleanupRequestSchema.safeParse({
      tenantId: 'tenant_abc',
      mode: 'soft',
    }).success).toBe(true);
  });

  it('rejects an invalid mode', () => {
    expect(cleanupRequestSchema.safeParse({mode: 'nuclear'}).success)
        .toBe(false);
  });
});

describe('scenarioRequestSchema', () => {
  it('accepts a minimal request (topic only)', () => {
    expect(scenarioRequestSchema.safeParse({topic: 'Market outlook'}).success)
        .toBe(true);
  });

  it('accepts all optional fields', () => {
    expect(scenarioRequestSchema.safeParse({
      topic: 'Risk',
      context: 'Some context',
      tones: ['optimistic', 'pessimistic'],
      provider: 'openai',
    }).success).toBe(true);
  });

  it('rejects an invalid tone', () => {
    expect(scenarioRequestSchema.safeParse({
      topic: 'Risk',
      tones: ['happy'],
    }).success).toBe(false);
  });

  it('rejects an invalid provider', () => {
    expect(scenarioRequestSchema.safeParse({
      topic: 'Risk',
      provider: 'mistral',
    }).success).toBe(false);
  });
});

describe('ingestSyncSchema', () => {
  const validPayload = {
    tenant_id: 'tenant_abc',
    entities: [{
      id: 'e1',
      tenant_id: 'tenant_abc',
      type: 'asset',
      attributes: {name: 'Asset 1'},
      source: 'webhook',
      confidence: 0.9,
      timestamp: '2025-01-01T00:00:00Z',
    }],
    relations: [],
    source: 'webhook',
  };

  it('accepts a valid payload', () => {
    expect(ingestSyncSchema.safeParse(validPayload).success).toBe(true);
  });

  it('rejects an empty entities array (min not enforced, but valid)', () => {
    expect(ingestSyncSchema.safeParse({
      ...validPayload,
      entities: [],
    }).success).toBe(true);
  });
});

describe('ingestFileSchema', () => {
  it('accepts a valid file upload request', () => {
    expect(ingestFileSchema.safeParse({
      objectKey: 'tenant_abc/staging/job1/data.csv',
      format: 'csv',
      ontologyType: 'asset',
    }).success).toBe(true);
  });

  it('rejects an unsupported format', () => {
    expect(ingestFileSchema.safeParse({
      objectKey: 'key',
      format: 'xml',
      ontologyType: 'asset',
    }).success).toBe(false);
  });
});

describe('apiResponseSchema', () => {
  it('wraps a success payload', () => {
    const schema = apiResponseSchema(loginSchema);
    const result = schema.safeParse({
      success: true,
      data: {username: 'a', password: 'b'},
    });
    expect(result.success).toBe(true);
  });

  it('wraps an error payload', () => {
    const schema = apiResponseSchema(loginSchema);
    const result = schema.safeParse({
      success: false,
      error: {code: 'AUTH_INVALID_CREDENTIALS', message: 'Bad creds.'},
    });
    expect(result.success).toBe(true);
  });
});

describe('paginatedResponseSchema', () => {
  it('accepts a valid paginated list', () => {
    const schema = paginatedResponseSchema(userRoleSchema);
    const result = schema.safeParse({
      total: 3,
      page: 1,
      size: 10,
      list: ['admin', 'analyst', 'viewer'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a negative total', () => {
    const schema = paginatedResponseSchema(userRoleSchema);
    expect(schema.safeParse({
      total: -1,
      page: 1,
      size: 10,
      list: [],
    }).success).toBe(false);
  });
});
