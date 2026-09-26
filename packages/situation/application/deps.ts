/**
 * @fileoverview Dependencies shared by the situation use-case handlers.
 */

import type {ObjectGraphRpc} from '@ontodecide/object-graph/contract';
import type {
  Clock,
  Logger,
  QueueName,
  QueueSender,
} from '@ontodecide/shared-kernel';
import type {DecisionJobMsg} from '../contract';
import type {
  RoomProvider,
  SituationRepositories,
  UsageGuardProvider,
} from './ports';

/** Everything a handler may need. */
export interface SituationDeps {
  repos: SituationRepositories;
  objects: ObjectGraphRpc;
  rooms: RoomProvider;
  usage: UsageGuardProvider;
  decisionJobs: QueueSender<DecisionJobMsg>;
  /** Producers used to replay dead letters, by logical queue name. */
  replayTargets: Partial<Record<QueueName, QueueSender<unknown>>>;
  clock: Clock;
  logger: Logger;
}
