import {
  LiveBatchPlanner,
  TimelineAssembler,
  type PlannedTranscriptionBatch,
  type TimelineRegionDraft,
} from '@toph/dictation-core';

import type { RecordingSessionStore } from '../../stores/session-store';
import { writeBatchWavsFromRawFile } from '../batch-audio-writer';
import { PcmFrameBuffer } from './pcm-frame-buffer';
import type { SegmentationPipelineOutcome, StreamingSpeechActivityAnalyzer } from './types';

export interface SegmentationPipelineSession {
  processPcmChunk: (chunk: Buffer) => Promise<void>;
  flush: () => Promise<SegmentationPipelineOutcome>;
  dispose: () => Promise<void>;
}

export async function createSegmentationPipelineSession(options: {
  sessionId: string;
  rawAudioPath: string;
  createdLive: boolean;
  generateBatchAudio: boolean;
  onBatchesReady?: (batches: PlannedTranscriptionBatch[]) => Promise<void> | void;
  analyzer: StreamingSpeechActivityAnalyzer;
  sessionStore: Pick<
    RecordingSessionStore,
    'insertTimelineRegions' | 'insertPlannedBatches' | 'updateBatchDerivedAudioPaths'
  >;
}): Promise<SegmentationPipelineSession> {
  const analyzerSession = await options.analyzer.createSession();
  const frameBuffer = new PcmFrameBuffer({
    sampleRate: options.analyzer.sampleRate,
    frameSizeSamples: options.analyzer.frameSizeSamples,
    analyzerSession,
  });
  const timelineAssembler = new TimelineAssembler({ createdLive: options.createdLive });
  const batchPlanner = new LiveBatchPlanner({
    sessionId: options.sessionId,
    createdLive: options.createdLive,
  });
  const persistedRegions: TimelineRegionDraft[] = [];
  const persistedBatches: PlannedTranscriptionBatch[] = [];

  const writeAudioForBatches = async (batches: PlannedTranscriptionBatch[]) => {
    if (!options.generateBatchAudio || batches.length === 0) {
      return;
    }

    const derivedAudioPaths = await writeBatchWavsFromRawFile({
      rawAudioPath: options.rawAudioPath,
      batches,
    });
    await options.sessionStore.updateBatchDerivedAudioPaths(derivedAudioPaths);
  };

  const persistPipelineOutput = async (regions: TimelineRegionDraft[]) => {
    if (regions.length === 0) {
      return;
    }

    await options.sessionStore.insertTimelineRegions({ sessionId: options.sessionId, regions });
    persistedRegions.push(...regions);

    const batches = batchPlanner.appendRegions(regions);
    if (batches.length === 0) {
      return;
    }

    await options.sessionStore.insertPlannedBatches({ sessionId: options.sessionId, batches });
    persistedBatches.push(...batches);
    await writeAudioForBatches(batches);
    await options.onBatchesReady?.(batches);
  };

  return {
    async processPcmChunk(chunk) {
      const probabilityFrames = await frameBuffer.processChunk(chunk);
      await persistPipelineOutput(timelineAssembler.processFrames(probabilityFrames));
    },

    async flush() {
      const probabilityFrames = await frameBuffer.flush();
      await persistPipelineOutput(timelineAssembler.processFrames(probabilityFrames));
      await persistPipelineOutput(timelineAssembler.flush());

      const finalBatches = batchPlanner.flush();
      if (finalBatches.length > 0) {
        await options.sessionStore.insertPlannedBatches({
          sessionId: options.sessionId,
          batches: finalBatches,
        });
        persistedBatches.push(...finalBatches);
        await writeAudioForBatches(finalBatches);
        await options.onBatchesReady?.(finalBatches);
      }

      return {
        regions: persistedRegions,
        batches: persistedBatches,
        result: persistedBatches.length === 0 ? 'no_speech' : 'segmented',
      };
    },

    async dispose() {
      await analyzerSession.dispose();
    },
  };
}
