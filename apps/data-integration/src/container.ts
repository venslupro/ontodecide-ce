/**
 * @fileoverview Composition root of data-integration.
 */

import {AwsClient} from 'aws4fetch';
import {createLogger, systemClock, ulid} from '@ontodecide/shared-kernel';
import type {Clock, Logger, QueueBatch} from '@ontodecide/shared-kernel';
import type {
  AppDeps,
  UploadPresigner,
} from '@ontodecide/integration/application';
import type {IntegrationRpc} from '@ontodecide/integration/contract';
import {
  AesSecretCipher,
  B2Presigner,
  CachedModelProvider,
  D1JobRepository,
  D1MaintenanceRepository,
  D1NonceRepository,
  D1RawRecordRepository,
  D1SourceRepository,
  DisabledPresigner,
  HttpRestFetcher,
  QueueIngestPublisher,
  QueueObjectWritePublisher,
} from '@ontodecide/integration/infrastructure';
import type {SigV4Signer} from '@ontodecide/integration/infrastructure';
import {
  createCronDispatcher,
  createIntegrationRpc,
  createQueueDispatcher,
} from '@ontodecide/integration/interface';
import type {Env} from './env';

/** Test and runtime overrides. */
export interface Overrides {
  clock?: Clock;
  logger?: Logger;
  /** Outbound fetch used by REST pulls. */
  fetch?: typeof fetch;
}

/** Wired services. */
export interface Container {
  deps: AppDeps;
  rpc: IntegrationRpc;
  queueHandler: (batch: QueueBatch<unknown>) => Promise<void>;
  cron: (cron: string, now: Date) => Promise<void>;
}

function presigner(env: Env, clock: Clock, logger: Logger): UploadPresigner {
  if (!env.B2_KEY_ID || !env.B2_APP_KEY || !env.B2_ENDPOINT || !env.B2_BUCKET) {
    logger.info('B2 credentials absent; raw file archiving disabled');
    return new DisabledPresigner(clock);
  }
  const client = new AwsClient({
    accessKeyId: env.B2_KEY_ID,
    secretAccessKey: env.B2_APP_KEY,
    service: 's3',
    region: env.B2_REGION,
  });
  return new B2Presigner({
    signer: client as unknown as SigV4Signer,
    endpoint: env.B2_ENDPOINT,
    bucket: env.B2_BUCKET,
    region: env.B2_REGION || undefined,
    clock,
  });
}

/** Builds the container from bindings. */
export function createContainer(
  env: Env,
  overrides: Overrides = {},
): Container {
  const clock = overrides.clock ?? systemClock;
  const logger =
    overrides.logger ?? createLogger({service: 'data-integration'});
  const db = env.INTEGRATION_DB;
  const deps: AppDeps = {
    sources: new D1SourceRepository(db),
    jobs: new D1JobRepository(db),
    rawRecords: new D1RawRecordRepository(db),
    nonces: new D1NonceRepository(db),
    maintenance: new D1MaintenanceRepository(db),
    ingestQueue: new QueueIngestPublisher(env.INGEST_QUEUE),
    objectWrites: new QueueObjectWritePublisher(env.OBJECT_WRITES_QUEUE),
    presigner: presigner(env, clock, logger),
    rest: new HttpRestFetcher(overrides.fetch),
    cipher: new AesSecretCipher(env.CONNECTOR_ENC_KEY, logger),
    models: new CachedModelProvider(env.ONTOLOGY, clock),
    clock,
    logger,
    newId: () => ulid(clock.now().getTime()),
  };
  return {
    deps,
    rpc: createIntegrationRpc(deps),
    queueHandler: createQueueDispatcher(deps),
    cron: createCronDispatcher(deps),
  };
}
