/**
 * @fileoverview Factory of a SituationRoomCore over Durable Object SQL
 * storage.
 */

import {
  type Clock,
  type Logger,
  silentLogger,
  systemClock,
} from '@ontodecide/shared-kernel';
import {
  type ObjectsPort,
  type OntologyPort,
  type RoomStorage,
  SituationRoomCore,
  type SocketHub,
} from '../application';
import {SqlRoomStore} from './sql_room_store';
import type {SqlStorageLike} from './sql_storage';

/** Inputs of {@link createSituationRoomCore}. */
export interface RoomCoreOptions {
  sql: SqlStorageLike;
  storage: RoomStorage;
  sockets: SocketHub;
  objects: ObjectsPort;
  ontology: OntologyPort;
  clock?: Clock;
  logger?: Logger;
}

/** Builds the room logic (runs the schema migration synchronously). */
export function createSituationRoomCore(o: RoomCoreOptions): SituationRoomCore {
  return new SituationRoomCore({
    store: new SqlRoomStore(o.sql),
    storage: o.storage,
    sockets: o.sockets,
    objects: o.objects,
    ontology: o.ontology,
    clock: o.clock ?? systemClock,
    logger: o.logger ?? silentLogger,
  });
}
