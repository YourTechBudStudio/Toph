import {
  LiveBatchPlanner,
  TimelineAssembler,
  type PlannedTranscriptionBatch,
  type SpeechProbabilityFrame,
  type TimelineRegionDraft,
} from '@toph/dictation-core';

import type { FramesEvent } from '../../../../modules/toph-voice';

const SAMPLE_RATE = 16_000;

/**
 * Desktop's frame timing (`apps/desktop/src/main/segmentation/streaming/pcm-frame-buffer.ts`):
 * sample offsets to milliseconds with exactly desktop's expression, and frames that round to zero
 * length dropped. A different operation order can round differently, so keep it as it is.
 */
export function toProbabilityFrames(event: FramesEvent): SpeechProbabilityFrame[] {
  const frames: SpeechProbabilityFrame[] = [];
  event.probabilities.forEach((speechProbability, index) => {
    const startMs = Math.round(((event.startSamples[index] ?? 0) / SAMPLE_RATE) * 1000);
    const endMs = Math.round(((event.endSamples[index] ?? 0) / SAMPLE_RATE) * 1000);
    if (endMs > startMs) {
      frames.push({ startMs, endMs, speechProbability });
    }
  });
  return frames;
}

/** One dictation's segmentation: Silero frames in, planned transcription batches out. */
export interface SegmentationRun {
  /** One live event: frames → assembler → planner. Returns batches planned at a pause. */
  push(event: FramesEvent): PlannedTranscriptionBatch[];
  /** The final event: its frames, then the assembler flush, then the planner flush. */
  finish(finalEvent: FramesEvent): PlannedTranscriptionBatch[];
  /** Every region finalized so far, in order (for parity). */
  readonly regions: readonly TimelineRegionDraft[];
}

/**
 * Desktop's segmentation order (`segmentation-pipeline-session.ts`) without persistence. The
 * assembler and planner work frame by frame and region by region, so how frames are grouped into
 * events does not change the result.
 */
export function createSegmentationRun(sessionId: string): SegmentationRun {
  const assembler = new TimelineAssembler({ createdLive: true });
  const planner = new LiveBatchPlanner({ sessionId, createdLive: true });
  const regions: TimelineRegionDraft[] = [];

  const plan = (finalized: TimelineRegionDraft[]) => {
    regions.push(...finalized);
    return planner.appendRegions(finalized);
  };

  return {
    push: (event) => plan(assembler.processFrames(toProbabilityFrames(event))),
    finish: (finalEvent) => [
      ...plan(assembler.processFrames(toProbabilityFrames(finalEvent))),
      ...plan(assembler.flush()),
      ...planner.flush(),
    ],
    regions,
  };
}
