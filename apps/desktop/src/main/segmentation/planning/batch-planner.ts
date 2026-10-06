import { randomUUID } from 'node:crypto';

import type {
  PlannedBatchSourceRange,
  PlannedTranscriptionBatch,
  TimelineRegionDraft,
} from '@toph/dictation-core';

export interface BatchPlanningPolicy {
  preferredMinDerivedBatchMs: number;
  longPauseThresholdMs: number;
  shortenedPauseMs: number;
}

const defaultPolicy: BatchPlanningPolicy = {
  preferredMinDerivedBatchMs: 10_000,
  longPauseThresholdMs: 1_500,
  shortenedPauseMs: 500,
};

function createBatchId() {
  return `batch_${Date.now()}_${randomUUID()}`;
}

function createRangeId() {
  return `range_${Date.now()}_${randomUUID()}`;
}

function hasSpeech(regions: TimelineRegionDraft[]) {
  return regions.some((region) => region.kind === 'speech');
}

function isBetweenSpeech(regions: TimelineRegionDraft[], index: number) {
  const previousSpeech = regions.slice(0, index).some((region) => region.kind === 'speech');
  const nextSpeech = regions.slice(index + 1).some((region) => region.kind === 'speech');
  return previousSpeech && nextSpeech;
}

function sourceDurationMs(ranges: PlannedBatchSourceRange[]) {
  if (ranges.length === 0) {
    return 0;
  }

  const startMs = Math.min(...ranges.map((range) => range.sourceStartMs));
  const endMs = Math.max(...ranges.map((range) => range.sourceEndMs));
  return endMs - startMs;
}

export function planTranscriptionBatches(options: {
  sessionId: string;
  regions: TimelineRegionDraft[];
  policy?: Partial<BatchPlanningPolicy>;
}): PlannedTranscriptionBatch[] {
  const policy = { ...defaultPolicy, ...options.policy };
  if (!hasSpeech(options.regions)) {
    return [];
  }

  const batches: PlannedTranscriptionBatch[] = [];
  let currentBatchId = createBatchId();
  let currentRanges: PlannedBatchSourceRange[] = [];
  let currentDerivedMs = 0;

  const flushBatch = () => {
    if (currentRanges.length === 0) {
      return;
    }

    batches.push({
      id: currentBatchId,
      sessionId: options.sessionId,
      sequence: batches.length,
      sourceDurationMs: sourceDurationMs(currentRanges),
      derivedAudioDurationMs: currentDerivedMs,
      createdLive: false,
      sourceRanges: currentRanges,
    });
    currentBatchId = createBatchId();
    currentRanges = [];
    currentDerivedMs = 0;
  };

  const appendRange = (range: Omit<PlannedBatchSourceRange, 'id' | 'batchId' | 'sequence'>) => {
    if (range.sourceEndMs <= range.sourceStartMs) {
      return;
    }

    currentRanges.push({
      id: createRangeId(),
      batchId: currentBatchId,
      sequence: currentRanges.length,
      ...range,
    });
    currentDerivedMs = range.derivedEndMs;
  };

  const appendPauseRange = (pauseRange: {
    region: TimelineRegionDraft;
    sourceStartMs: number;
    sourceEndMs: number;
    reason: 'pause_buffer' | 'normal_pause';
  }) => {
    const durationMs = pauseRange.sourceEndMs - pauseRange.sourceStartMs;
    appendRange({
      timelineRegionId: pauseRange.region.id,
      sourceStartMs: pauseRange.sourceStartMs,
      sourceEndMs: pauseRange.sourceEndMs,
      derivedStartMs: currentDerivedMs,
      derivedEndMs: currentDerivedMs + durationMs,
      reason: pauseRange.reason,
    });
  };

  options.regions.forEach((region, index) => {
    const durationMs = region.endMs - region.startMs;
    if (region.kind === 'speech') {
      appendRange({
        timelineRegionId: region.id,
        sourceStartMs: region.startMs,
        sourceEndMs: region.endMs,
        derivedStartMs: currentDerivedMs,
        derivedEndMs: currentDerivedMs + durationMs,
        reason: 'speech',
      });
      return;
    }

    if (!isBetweenSpeech(options.regions, index)) {
      return;
    }

    if (durationMs <= policy.longPauseThresholdMs) {
      appendPauseRange({
        region,
        sourceStartMs: region.startMs,
        sourceEndMs: region.endMs,
        reason: 'normal_pause',
      });
    } else {
      // Preserve both pause edges so soft starts/ends around a long pause are not clipped.
      const leadingPauseMs = Math.min(policy.shortenedPauseMs, Math.floor(durationMs / 2));
      const trailingPauseMs = Math.min(policy.shortenedPauseMs, durationMs - leadingPauseMs);
      const trailingStartMs = Math.max(
        region.startMs + leadingPauseMs,
        region.endMs - trailingPauseMs,
      );

      appendPauseRange({
        region,
        sourceStartMs: region.startMs,
        sourceEndMs: region.startMs + leadingPauseMs,
        reason: 'pause_buffer',
      });
      appendPauseRange({
        region,
        sourceStartMs: trailingStartMs,
        sourceEndMs: region.endMs,
        reason: 'pause_buffer',
      });
    }

    if (currentDerivedMs >= policy.preferredMinDerivedBatchMs) {
      flushBatch();
    }
  });

  flushBatch();
  return batches;
}
