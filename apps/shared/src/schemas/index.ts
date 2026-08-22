/**
 * Zod v4 schemas for every DTO and shared domain type used across the
 * OntoDecide services.
 *
 * The file is intentionally self-contained: it does not import from the
 * existing `dto`/`types` modules — every shape is re-declared here as a Zod
 * schema so the same definition serves both runtime validation and OpenAPI
 * generation (via `@hono/zod-openapi`).
 *
 * Conventions:
 *  - Each Zod schema constant uses a `Schema` suffix (e.g. `loginSchema`).
 *  - Each schema exports a matching inferred type via `z.infer<typeof xSchema>`.
 *  - Generic envelopes (`ApiResponse<T>`, `PaginatedResponse<T>`) are exposed
 *    as factory functions that accept the inner `z.ZodTypeAny`.
 *  - `.openapi({ description })` metadata is attached to fields where it aids
 *    generated API documentation.
 */
import { z } from 'zod';
import { extendZodWithOpenApi } from '@hono/zod-openapi';

// Idempotently enables `.openapi()` metadata on every Zod schema.
extendZodWithOpenApi(z);

// ---------------------------------------------------------------------------
// Common types (types/common.ts)
// ---------------------------------------------------------------------------

/** Normalized error payload returned inside {@link ApiResponse}. */
export const apiErrorSchema = z.object({
  code: z.string().openapi({ description: 'Stable error code, e.g. AUTH_INVALID_CREDENTIALS.' }),
  message: z.string().openapi({ description: 'Human-readable message in the user locale.' }),
  details: z
    .record(z.string(), z.string())
    .optional()
    .openapi({ description: 'Optional field-level validation details.' }),
});

/**
 * Standard API response envelope returned by every Worker.
 *
 * Generic over the `data` payload; pass a concrete Zod schema, e.g.
 * `apiResponseSchema(authTokensSchema)`.
 */
export const apiResponseSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    success: z.boolean().openapi({ description: 'Whether the request succeeded.' }),
    data: data.optional().openapi({ description: 'Response payload on success.' }),
    error: apiErrorSchema.optional().openapi({ description: 'Error details on failure.' }),
    traceId: z
      .string()
      .optional()
      .openapi({ description: 'Server-side trace id, useful for debugging.' }),
  });

/**
 * Paginated list response.
 *
 * Generic over the item type: `paginatedResponseSchema(userPublicSchema)`.
 */
export const paginatedResponseSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    total: z
      .number()
      .int()
      .nonnegative()
      .openapi({ description: 'Total records matching the query.' }),
    page: z.number().int().positive().openapi({ description: 'Current page number (1-based).' }),
    size: z.number().int().positive().openapi({ description: 'Page size used for the query.' }),
    list: z.array(item).openapi({ description: 'Records on the current page.' }),
  });

/** Pagination query parameters. */
export const pageQuerySchema = z.object({
  page: z.number().int().positive().optional().openapi({ description: 'Page number (1-based).' }),
  size: z
    .number()
    .int()
    .positive()
    .optional()
    .openapi({ description: 'Number of records per page.' }),
});

// ---------------------------------------------------------------------------
// User types (types/user.ts)
// ---------------------------------------------------------------------------

/** Role assigned to a user; gates which admin endpoints they may call. */
export const userRoleSchema = z.enum(['admin', 'analyst', 'viewer']);

/** Public user record returned to clients (never contains password_hash). */
export const userPublicSchema = z.object({
  id: z.string().openapi({ description: 'Stable user id.' }),
  tenant_id: z.string().openapi({ description: 'Owning tenant id, format tenant_xxxx.' }),
  username: z.string().openapi({ description: 'Login username.' }),
  email: z.string().nullable().openapi({ description: 'Contact email, or null when unset.' }),
  role: userRoleSchema.openapi({ description: 'Authorization role.' }),
  is_active: z.boolean().openapi({ description: 'Whether the account may authenticate.' }),
  is_data_cleared: z
    .boolean()
    .openapi({ description: 'Whether a data-cleanup has run for the user.' }),
  must_change_password: z
    .boolean()
    .openapi({ description: 'Whether the user must change their password on next login.' }),
  expires_at: z
    .string()
    .nullable()
    .openapi({ description: 'ISO-8601 account expiration timestamp, or null.' }),
  created_at: z.string().openapi({ description: 'ISO-8601 creation timestamp.' }),
  last_login_at: z
    .string()
    .nullable()
    .openapi({ description: 'ISO-8601 last login timestamp, or null.' }),
  last_cleanup_at: z
    .string()
    .nullable()
    .openapi({ description: 'ISO-8601 last cleanup timestamp, or null.' }),
  data_retention_days: z
    .number()
    .int()
    .positive()
    .openapi({ description: 'Per-user data-retention window in days.' }),
  data_size_estimate: z
    .number()
    .int()
    .nonnegative()
    .openapi({ description: 'Estimated stored data size in bytes.' }),
});

/** Result returned when an admin creates or resets a user. */
export const credentialResultSchema = z.object({
  id: z.string().openapi({ description: 'User id the credentials belong to.' }),
  tenant_id: z.string().openapi({ description: 'Tenant the user belongs to.' }),
  username: z.string().openapi({ description: 'Login username.' }),
  temporary_password: z.string().openapi({
    description: 'Plaintext password, only visible at creation/reset time.',
  }),
});

// ---------------------------------------------------------------------------
// Graph types (types/graph.ts)
// ---------------------------------------------------------------------------

/** Definition of a node/edge type in the tenant ontology. */
export const ontologyTypeSchema = z.object({
  id: z.string().openapi({ description: 'Stable id, e.g. asset.' }),
  name: z.string().openapi({ description: 'Human-readable name.' }),
  properties: z.array(z.string()).openapi({ description: 'Property keys allowed on this type.' }),
  relations: z.array(z.string()).openapi({ description: 'Relation types allowed on this type.' }),
  created_at: z.string().optional().openapi({ description: 'ISO-8601 creation timestamp.' }),
});

/** Entity node stored in Neo4j. */
export const entityNodeSchema = z.object({
  id: z.string().openapi({ description: 'Stable entity id.' }),
  tenant_id: z.string().openapi({ description: 'Owning tenant id.' }),
  type: z.string().openapi({ description: 'Ontology type label of the entity.' }),
  attributes: z
    .record(z.string(), z.unknown())
    .openapi({ description: 'Arbitrary key/value attributes of the entity.' }),
  source: z.string().openapi({ description: 'Source identifier that produced the entity.' }),
  confidence: z.number().openapi({ description: 'Confidence score of the entity (0..1).' }),
  timestamp: z.string().openapi({ description: 'ISO-8601 timestamp of the entity.' }),
});

/** Directional relationship between two entities. */
export const entityRelationSchema = z.object({
  type: z.string().openapi({ description: 'Edge type label, e.g. LOCATED_AT.' }),
  source: z.string().openapi({ description: 'Source entity id.' }),
  target: z.string().openapi({ description: 'Target entity id.' }),
  properties: z
    .record(z.string(), z.unknown())
    .optional()
    .openapi({ description: 'Optional edge properties.' }),
});

/**
 * Minimal entity reference used as a relation target inside
 * {@link situationNodeSchema} (a Pick of {@link EntityNode}).
 */
const entityNodeRefSchema = z.object({
  id: z.string().openapi({ description: 'Target entity id.' }),
  type: z.string().openapi({ description: 'Target entity type.' }),
  attributes: z
    .record(z.string(), z.unknown())
    .openapi({ description: 'Target entity attributes.' }),
});

/** Situation-view node enriched with first-hop relations. */
export const situationNodeSchema = z.object({
  entity: entityNodeSchema.openapi({ description: 'Root entity of the view.' }),
  relations: z
    .array(
      z.object({
        type: z.string().openapi({ description: 'Relation type label.' }),
        target: entityNodeRefSchema.openapi({
          description: 'Target entity (id, type, attributes).',
        }),
      }),
    )
    .openapi({ description: 'First-hop relations of the root entity.' }),
});

/** Request body for the /graph/explore endpoint. */
export const exploreRequestSchema = z.object({
  entityId: z.string().openapi({ description: 'Root entity id to start exploration from.' }),
  depth: z
    .number()
    .int()
    .min(1)
    .max(3)
    .optional()
    .openapi({ description: 'How many hops to traverse (1..3, max 3).' }),
  relationTypes: z
    .array(z.string())
    .optional()
    .openapi({ description: 'Filter relations by type.' }),
});

/** Request body for the custom Cypher endpoint (admin-only). */
export const cypherQueryRequestSchema = z.object({
  statement: z.string().openapi({ description: 'Cypher statement to execute.' }),
  parameters: z
    .record(z.string(), z.unknown())
    .optional()
    .openapi({ description: 'Bind parameters for the statement.' }),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .openapi({ description: 'Maximum rows returned, defaults to 100.' }),
});

/** Generic payload describing a batch of entities + relations to ingest. */
export const ingestPayloadSchema = z.object({
  tenant_id: z.string().openapi({ description: 'Owning tenant id.' }),
  entities: z.array(entityNodeSchema).openapi({ description: 'Entities to upsert.' }),
  relations: z.array(entityRelationSchema).openapi({ description: 'Relations to upsert.' }),
  source: z.string().openapi({ description: 'Source identifier (webhook id, file name, etc.).' }),
});

// ---------------------------------------------------------------------------
// AI types (types/ai.ts)
// ---------------------------------------------------------------------------

/** Three-point scenario synthesis tone requested by the analyst. */
export const scenarioToneSchema = z.enum(['optimistic', 'pessimistic', 'neutral']);

/** Identifier for a supported LLM provider. */
export const llmProviderSchema = z.enum([
  'workers-ai',
  'openai',
  'anthropic',
  'google',
  'openrouter',
]);

/** Output of the scenario-simulation feature. */
export const scenarioResultSchema = z.object({
  tenant_id: z.string().openapi({ description: 'Owning tenant id.' }),
  topic: z.string().openapi({ description: 'Topic or question the scenario was generated for.' }),
  scenarios: z
    .array(
      z.object({
        tone: scenarioToneSchema.openapi({ description: 'Tone of the narrative.' }),
        narrative: z.string().openapi({ description: 'Generated narrative text.' }),
        keyFactors: z
          .array(z.string())
          .openapi({ description: 'Key factors driving the scenario.' }),
        probability: z
          .number()
          .openapi({ description: 'Estimated probability of the scenario (0..1).' }),
      }),
    )
    .openapi({ description: 'Generated scenarios, one per tone.' }),
  generatedAt: z.string().openapi({ description: 'ISO-8601 generation timestamp.' }),
  provider: llmProviderSchema.openapi({ description: 'Provider that served the call.' }),
});

/** Structured recommendation produced by the decision service. */
export const recommendationSchema = z.object({
  id: z.string().openapi({ description: 'Stable recommendation id.' }),
  tenant_id: z.string().openapi({ description: 'Owning tenant id.' }),
  topic: z.string().openapi({ description: 'Topic the recommendation addresses.' }),
  priority: z
    .enum(['low', 'medium', 'high', 'critical'])
    .openapi({ description: 'Priority of the recommendation.' }),
  confidence: z.number().openapi({ description: 'Confidence score of the recommendation (0..1).' }),
  rationale: z.string().openapi({ description: 'Reasoning behind the recommendation.' }),
  steps: z
    .array(
      z.object({
        order: z.number().int().positive().openapi({ description: '1-based execution order.' }),
        action: z.string().openapi({ description: 'Action to perform.' }),
        expectedOutcome: z.string().openapi({ description: 'Expected outcome of the action.' }),
      }),
    )
    .openapi({ description: 'Ordered steps to act on the recommendation.' }),
  generatedAt: z.string().openapi({ description: 'ISO-8601 generation timestamp.' }),
  provider: llmProviderSchema.openapi({ description: 'Provider that served the call.' }),
});

/** Lifecycle status of a planning-agent task. */
export const agentTaskStatusSchema = z.enum([
  'pending',
  'in_progress',
  'succeeded',
  'failed',
  'skipped',
]);

/** A single task planned by the autonomous agent. */
export const agentTaskSchema = z.object({
  id: z.string().openapi({ description: 'Stable task id.' }),
  description: z.string().openapi({ description: 'What the task should accomplish.' }),
  status: agentTaskStatusSchema.openapi({ description: 'Lifecycle status of the task.' }),
  result: z.string().optional().openapi({ description: 'Result text once the task finished.' }),
  startedAt: z.string().optional().openapi({ description: 'ISO-8601 start timestamp.' }),
  finishedAt: z.string().optional().openapi({ description: 'ISO-8601 finish timestamp.' }),
});

/** State persisted in the PlanningAgent Durable Object. */
export const agentStateSchema = z.object({
  goal: z.string().openapi({ description: 'High-level goal the agent pursues.' }),
  tasks: z.array(agentTaskSchema).openapi({ description: 'Tasks planned for the goal.' }),
  status: z
    .enum(['idle', 'planning', 'executing', 'reflecting', 'done'])
    .openapi({ description: 'Current phase of the agent lifecycle.' }),
  createdAt: z.string().openapi({ description: 'ISO-8601 creation timestamp.' }),
  updatedAt: z.string().openapi({ description: 'ISO-8601 last-update timestamp.' }),
});

// ---------------------------------------------------------------------------
// Auth DTOs (dto/login.dto.ts)
// ---------------------------------------------------------------------------

/** DTO for POST /api/auth/login. */
export const loginSchema = z.object({
  username: z.string().openapi({ description: 'Login username.' }),
  password: z.string().openapi({ description: 'Plaintext password (transmitted over TLS).' }),
});

/** DTO for POST /api/auth/refresh. */
export const refreshSchema = z.object({
  refreshToken: z.string().openapi({ description: 'Refresh token issued at login.' }),
});

/** Tokens returned by login / refresh. */
export const authTokensSchema = z.object({
  accessToken: z.string().openapi({ description: 'Short-lived JWT access token.' }),
  refreshToken: z.string().openapi({ description: 'Long-lived refresh token.' }),
  expiresIn: z
    .number()
    .int()
    .positive()
    .openapi({ description: 'Access token expiry epoch seconds.' }),
});

// ---------------------------------------------------------------------------
// User DTOs (dto/create-user.dto.ts)
// ---------------------------------------------------------------------------

/** DTO for POST /api/admin/users. */
export const createUserSchema = z.object({
  username: z.string().min(3).max(254).optional().openapi({
    description:
      'Login name (typically the email). When omitted, `email` is used as the login name.',
  }),
  role: userRoleSchema
    .optional()
    .openapi({ description: 'Role assigned to the new user. Defaults to analyst.' }),
  email: z
    .email()
    .optional()
    .openapi({ description: 'Contact email. Also used as login name when `username` is omitted.' }),
  dataRetentionDays: z.number().int().min(1).max(365).optional().openapi({
    description: 'Optional override of the global data-retention window in days (1..365).',
  }),
});

/** DTO for POST /api/applications (public account application). */
export const accountApplicationSchema = z.object({
  email: z.email().openapi({
    description: 'Applicant email — used as login username and delivery address for credentials.',
  }),
  usageDays: z
    .number()
    .int()
    .min(1)
    .max(90)
    .openapi({ description: 'Requested usage duration in days (1..90).' }),
});

/** Response for POST /api/applications. */
export const applicationResultSchema = z.object({
  id: z.string().openapi({ description: 'Created user id.' }),
  username: z.string().openapi({ description: 'Login username (the email address).' }),
  expires_at: z.string().openapi({ description: 'ISO-8601 expiration timestamp.' }),
  email_sent: z.boolean().openapi({ description: 'Whether the credential email was delivered.' }),
  temporary_password: z
    .string()
    .optional()
    .openapi({ description: 'Temporary password (only present when email could not be sent).' }),
});

/** DTO for POST /api/auth/change-password (first-login activation). */
export const changePasswordSchema = z.object({
  currentPassword: z.string().openapi({ description: 'Current (temporary) password.' }),
  newPassword: z.string().min(8).max(128).openapi({ description: 'New password (8..128 chars).' }),
});

/** Extended auth tokens response that includes the password-change flag. */
export const authTokensWithActivationSchema = z.object({
  accessToken: z.string().openapi({ description: 'Short-lived JWT access token.' }),
  refreshToken: z
    .string()
    .nullable()
    .openapi({ description: 'Long-lived refresh token (null until password is changed).' }),
  expiresIn: z
    .number()
    .int()
    .positive()
    .openapi({ description: 'Access token expiry epoch seconds.' }),
  requirePasswordChange: z.boolean().optional().openapi({
    description: 'When true, the caller must change their password before using the system.',
  }),
});

// ---------------------------------------------------------------------------
// Ingestion DTOs (dto/ingest-request.dto.ts)
// ---------------------------------------------------------------------------

/** Sync ingestion request: small payloads (<=10 entities). Aliases IngestPayload. */
export const ingestSyncSchema = ingestPayloadSchema;

/** Async ingestion request: file upload metadata. */
export const ingestFileSchema = z.object({
  objectKey: z.string().openapi({ description: 'Tenant-scoped object key under R2.' }),
  format: z
    .enum(['csv', 'json', 'parquet', 'webhook'])
    .openapi({ description: 'Format hint used by the ETL transformer.' }),
  ontologyType: z
    .string()
    .openapi({ description: 'Ontology type the records should be mapped onto.' }),
  fieldMapping: z
    .record(z.string(), z.string())
    .optional()
    .openapi({ description: 'Optional field-mapping overrides.' }),
});

/** Result returned by the sync ingestion path. */
export const ingestSyncResultSchema = z.object({
  accepted: z.number().int().nonnegative().openapi({ description: 'Number of records accepted.' }),
  rejected: z.number().int().nonnegative().openapi({ description: 'Number of records rejected.' }),
  errors: z
    .array(z.string())
    .optional()
    .openapi({ description: 'Per-record rejection reasons, when present.' }),
});

/** Result returned when an async job is enqueued. */
export const ingestJobEnqueuedSchema = z.object({
  jobId: z.string().openapi({ description: 'Id of the enqueued ingestion job.' }),
  status: z.literal('queued').openapi({ description: 'Initial job status.' }),
});

// ---------------------------------------------------------------------------
// Scenario DTOs (dto/scenario-request.dto.ts)
// ---------------------------------------------------------------------------

/** Request body for POST /api/ai/scenario. */
export const scenarioRequestSchema = z.object({
  topic: z.string().openapi({ description: 'Free-form topic or question to simulate.' }),
  context: z
    .string()
    .optional()
    .openapi({ description: 'Optional context bundle (entity summaries, prior decisions).' }),
  tones: z
    .array(scenarioToneSchema)
    .optional()
    .openapi({ description: 'Tones to generate; defaults to all three.' }),
  provider: llmProviderSchema.optional().openapi({ description: 'Optional provider override.' }),
});

/** Request body for POST /api/ai/recommend. */
export const recommendationRequestSchema = z.object({
  topic: z.string().openapi({ description: 'Topic to produce recommendations for.' }),
  history: z
    .string()
    .optional()
    .openapi({ description: 'Historical reference text the model should reason from.' }),
  provider: llmProviderSchema.optional().openapi({ description: 'Optional provider override.' }),
});

/** Request body for POST /api/ai/agent/plan. */
export const agentPlanRequestSchema = z.object({
  goal: z.string().openapi({ description: 'High-level goal the agent should plan for.' }),
  provider: llmProviderSchema.optional().openapi({ description: 'Optional provider override.' }),
});

// ---------------------------------------------------------------------------
// Cleanup DTOs (dto/cleanup-request.dto.ts)
// ---------------------------------------------------------------------------

/** Request body for POST /api/admin/cleanup. */
export const cleanupRequestSchema = z.object({
  tenantId: z.string().optional().openapi({
    description: 'Limit cleanup to a single tenant. If omitted, all due tenants run.',
  }),
  mode: z.enum(['soft', 'hard']).optional().openapi({
    description: 'Soft keeps audit + backups, hard purges everything including archives.',
  }),
});

/** Status response for GET /api/admin/cleanup/status/:taskId. */
export const cleanupStatusSchema = z.object({
  taskId: z.string().openapi({ description: 'Cleanup task id.' }),
  status: z
    .enum(['queued', 'running', 'succeeded', 'failed'])
    .openapi({ description: 'Current lifecycle status of the task.' }),
  progress: z
    .number()
    .int()
    .min(0)
    .max(100)
    .openapi({ description: 'Progress percentage (0..100).' }),
  processed: z.number().int().nonnegative().openapi({ description: 'Tenants processed so far.' }),
  total: z.number().int().nonnegative().openapi({ description: 'Total tenants to process.' }),
  startedAt: z.string().optional().openapi({ description: 'ISO-8601 start timestamp.' }),
  finishedAt: z.string().optional().openapi({ description: 'ISO-8601 finish timestamp.' }),
  error: z.string().optional().openapi({ description: 'Error message on failure.' }),
});
