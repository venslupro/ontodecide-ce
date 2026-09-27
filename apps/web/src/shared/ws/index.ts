/**
 * @fileoverview Public surface of the realtime module.
 */

export {
  applyFrames,
  configureStream,
  mergeOverview,
  registerStreamMerger,
  releaseAll,
  useRealtimeStatus,
  useSituationStream,
  type RealtimeStatus,
  type StreamMerger,
} from './stream';
export type {WsFrame, WsState} from './ws_client';
