/**
 * Filtered barrel for @ontodecide/shared consumed by apps/web.
 *
 * Instead of transiting through @ontodecide/shared's main barrel (which
 * re-exports Cloudflare-only binding types + Web Crypto utils that are
 * type-incompatible with the DOM lib under strict generics), we re-export
 * exactly the symbols we need straight from their source files. All files
 * on this list are pure types/values with no dependency on env.ts,
 * crypto.ts or storage/*, so TypeScript never needs the
 * @cloudflare/workers-types ambient globals and never sees the
 * DOM-vs-ES Uint8Array generic mismatch.
 */

// ── types ─────────────────────────────────────────────────────────

export type {
  UserRole,
  UserState,
  JwtPayload,
  UserPublic,
  UserRow,
  AuditLogRow,
  AuditAction,
  CredentialResult,
} from '../../../../apps/shared/src/types/user';

export type {
  LlmProvider,
  LlmOptions,
  TokenUsage,
  LlmResponse,
  ScenarioTone,
  ScenarioResult,
  Recommendation,
  AgentTaskStatus,
  AgentTask,
  AgentState,
} from '../../../../apps/shared/src/types/ai';

export type {
  OntologyType,
  EntityNode,
  EntityRelation,
  SituationNode,
  ExploreRequest,
  CypherQueryRequest,
  IngestPayload,
} from '../../../../apps/shared/src/types/graph';

export type {
  ApiResponse,
  ApiError,
  PaginatedResponse,
  PageQuery,
  Result,
} from '../../../../apps/shared/src/types/common';

// ── dto ─────────────────────────────────────────────────────────

export * from '../../../../apps/shared/src/dto/login.dto';
export * from '../../../../apps/shared/src/dto/create-user.dto';
export * from '../../../../apps/shared/src/dto/scenario-request.dto';
export * from '../../../../apps/shared/src/dto/ingest-request.dto';
export * from '../../../../apps/shared/src/dto/cleanup-request.dto';

// ── utils (non-crypto, non-storage) ─────────────────────────────

export * from '../../../../apps/shared/src/utils/response';
export * from '../../../../apps/shared/src/utils/validators';
export * from '../../../../apps/shared/src/utils/id-generator';
export * from '../../../../apps/shared/src/utils/date-utils';

// ── constants ────────────────────────────────────────────────────

export * from '../../../../apps/shared/src/constants';
