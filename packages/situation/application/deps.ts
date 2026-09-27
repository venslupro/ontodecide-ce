/**
 * @fileoverview Dependencies of a SituationRoom core.
 */

import type {Clock, Logger} from '@ontodecide/shared-kernel';
import type {
  ObjectsPort,
  OntologyPort,
  RoomStorage,
  RoomStore,
  SocketHub,
} from './ports';

/** Service principal name used for upstream calls made by the room. */
export const SITUATION_SERVICE = 'situation-awareness';

/** Everything a room needs. */
export interface RoomDeps {
  store: RoomStore;
  storage: RoomStorage;
  sockets: SocketHub;
  objects: ObjectsPort;
  ontology: OntologyPort;
  clock: Clock;
  logger: Logger;
}
