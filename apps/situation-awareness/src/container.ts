/**
 * @fileoverview Composition root of situation-awareness.
 */

import {
  type Clock,
  type Logger,
  type QueueBatch,
  type TenantLifecycleRpc,
  createLogger,
  systemClock,
} from '@ontodecide/shared-kernel';
import type {
  RoomStorage,
  SituationRoomApi,
  SituationRoomCore,
  SocketHub,
} from '@ontodecide/situation/application';
import type {SituationRpc} from '@ontodecide/situation/contract';
import {
  type SqlStorageLike,
  createSituationRoomCore,
} from '@ontodecide/situation/infrastructure';
import {
  type RoomFetcher,
  type RoomResolver,
  createDomainEventsConsumer,
  createSituationLifecycle,
  createSituationRpc,
  createStreamFetch,
  problemResponse,
} from '@ontodecide/situation/interface';
import type {Env} from './env';

/** A SituationRoom stub (RPC methods + fetch). */
export type RoomStub = SituationRoomApi & RoomFetcher;

/** Test / wiring overrides. */
export interface Overrides {
  clock?: Clock;
  logger?: Logger;
  /** Replaces the Durable Object namespace lookup. */
  rooms?: RoomResolver<RoomStub>;
}

/** Assembled situation-awareness dependencies. */
export interface Container {
  logger: Logger;
  rooms: RoomResolver<RoomStub>;
  rpc: SituationRpc;
  lifecycle: Required<Omit<TenantLifecycleRpc, 'tenantStats'>>;
  queue(batch: QueueBatch<unknown>): Promise<void>;
  fetch(request: Request): Promise<Response>;
}

function makeLogger(env: Env): Logger {
  return createLogger({
    service: 'situation-awareness',
    env: env.ENVIRONMENT ?? 'local',
    version: env.APP_VERSION ?? 'dev',
  });
}

/** Room stub of a workspace: `SITUATION_ROOM.idFromName(tid)`. */
export function roomStub(ns: DurableObjectNamespace, tid: string): RoomStub {
  return ns.get(ns.idFromName(tid)) as unknown as RoomStub;
}

/** Builds the container from the Worker bindings. */
export function createContainer(
  env: Env,
  overrides: Overrides = {},
): Container {
  const logger = overrides.logger ?? makeLogger(env);
  const rooms: RoomResolver<RoomStub> =
    overrides.rooms ?? (tid => roomStub(env.SITUATION_ROOM, tid));
  const stream = createStreamFetch(rooms);
  const origin = env.APP_ORIGIN?.replace(/\/+$/, '');
  return {
    logger,
    rooms,
    rpc: createSituationRpc(rooms),
    lifecycle: createSituationLifecycle(rooms),
    queue: createDomainEventsConsumer({rooms, logger}),
    fetch: async request => {
      // Defense in depth: the gateway already checked the Origin.
      const o = request.headers.get('Origin');
      if (origin && o && o !== origin) {
        return problemResponse('FORBIDDEN', 'Origin not allowed');
      }
      return stream(request);
    },
  };
}

/** Durable Object runtime pieces handed to a room core. */
export interface RoomRuntimeParts {
  sql: SqlStorageLike;
  storage: RoomStorage;
  sockets: SocketHub;
}

/** Builds the logic of one SituationRoom instance. */
export function createRoomCore(
  env: Env,
  parts: RoomRuntimeParts,
  overrides: Pick<Overrides, 'clock' | 'logger'> = {},
): SituationRoomCore {
  return createSituationRoomCore({
    ...parts,
    objects: env.OBJECTS,
    ontology: env.ONTOLOGY,
    clock: overrides.clock ?? systemClock,
    logger: overrides.logger ?? makeLogger(env).child({do: 'SituationRoom'}),
  });
}
