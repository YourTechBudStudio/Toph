import type { RecordingSessionStore } from '../stores/session-store';
import type { StreamingSpeechActivityAnalyzer } from './analyzers/streaming-speech-activity-analyzer';
import { createSegmentationPipelineSession } from './streaming/segmentation-pipeline-session';
import type { SegmentationPipelineSession } from './streaming/segmentation-pipeline-session';
import { streamPcm16MonoWav } from './streaming/wav-stream-source';
import { createDefaultStreamingVadRuntime } from './streaming-vad-runtime';
import type { PlannedTranscriptionBatch } from './types';

export type SegmentationOutcome = 'segmented' | 'no_speech';

export interface SessionSegmentationService {
  createLiveSession: (options: {
    sessionId: string;
    rawAudioPath: string;
    generateBatchAudio: boolean;
    onBatchesReady?: (batches: PlannedTranscriptionBatch[]) => Promise<void> | void;
  }) => Promise<SegmentationPipelineSession>;
  segmentRecordedSession: (options: {
    sessionId: string;
    generateBatchAudio: boolean;
    audioPath?: string;
    preserveSelectedOutput?: boolean;
  }) => Promise<SegmentationOutcome>;
}

function describeSegmentationError(error: unknown) {
  const detail = error instanceof Error ? error.message : 'Unknown error';
  return `Segmentation failed: ${detail}`;
}

export function createSessionSegmentationService(options: {
  sessionStore: Pick<
    RecordingSessionStore,
    | 'getSession'
    | 'markSegmenting'
    | 'markSegmented'
    | 'markNoSpeech'
    | 'markRecordedWithProcessingError'
    | 'clearSegmentationData'
    | 'insertTimelineRegions'
    | 'insertPlannedBatches'
    | 'updateBatchDerivedAudioPaths'
  >;
  vadRuntime?: StreamingSpeechActivityAnalyzer;
}): SessionSegmentationService {
  const vadRuntime = options.vadRuntime ?? createDefaultStreamingVadRuntime();

  return {
    async createLiveSession({ sessionId, rawAudioPath, generateBatchAudio, onBatchesReady }) {
      return createSegmentationPipelineSession({
        sessionId,
        rawAudioPath,
        createdLive: true,
        generateBatchAudio,
        onBatchesReady,
        analyzer: vadRuntime,
        sessionStore: options.sessionStore,
      });
    },

    async segmentRecordedSession({
      sessionId,
      generateBatchAudio,
      audioPath,
      preserveSelectedOutput,
    }) {
      try {
        const session = await options.sessionStore.getSession(sessionId);
        if (!session) {
          throw new Error(`Recording session ${sessionId} does not exist.`);
        }
        if (session.status !== 'recorded') {
          throw new Error(`Recording session ${sessionId} is not ready for segmentation.`);
        }

        await options.sessionStore.markSegmenting(sessionId);
        await options.sessionStore.clearSegmentationData(sessionId, { preserveSelectedOutput });

        const pipeline = await createSegmentationPipelineSession({
          sessionId,
          rawAudioPath: audioPath ?? session.rawAudioPath,
          createdLive: false,
          generateBatchAudio,
          analyzer: vadRuntime,
          sessionStore: options.sessionStore,
        });

        try {
          await streamPcm16MonoWav({
            filePath: audioPath ?? session.rawAudioPath,
            onChunk: pipeline.processPcmChunk,
          });
          const outcome = await pipeline.flush();
          console.info(
            `Toph streaming segmentation pipeline ${vadRuntime.name} produced ${outcome.regions.length} timeline regions and ${outcome.batches.length} batches for session ${sessionId}.`,
          );

          if (outcome.result === 'no_speech') {
            await options.sessionStore.markNoSpeech(sessionId);
            return 'no_speech';
          }

          await options.sessionStore.markSegmented(sessionId);
          return 'segmented';
        } finally {
          await pipeline.dispose();
        }
      } catch (error) {
        await options.sessionStore.clearSegmentationData(sessionId, { preserveSelectedOutput });
        await options.sessionStore.markRecordedWithProcessingError({
          sessionId,
          errorMessage: describeSegmentationError(error),
        });
        throw error;
      }
    },
  };
}
