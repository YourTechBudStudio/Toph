import type { PlannedTranscriptionBatch, TimelineRegionDraft } from '@toph/dictation-core';

export interface StreamingSpeechActivityAnalyzer {
  name: string;
  sampleRate: number;
  frameSizeSamples: number;
  createSession: () => Promise<StreamingSpeechActivityAnalyzerSession>;
}

export interface StreamingSpeechActivityAnalyzerSession {
  scoreFrame: (frame: Float32Array) => Promise<number>;
  flush: () => Promise<void>;
  dispose: () => Promise<void>;
}

export interface SegmentationPipelineOutcome {
  regions: TimelineRegionDraft[];
  batches: PlannedTranscriptionBatch[];
  result: 'segmented' | 'no_speech';
}
