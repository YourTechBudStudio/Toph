import { randomUUID } from 'node:crypto';

import type {
  PlannedBatchSourceRange,
  PlannedTranscriptionBatch,
  TimelineRegionDraft,
} from '../types';

export interface LiveBatchPlanningPolicy {
  preferredMinDerivedBatchMs: number;
  longPauseThresholdMs: number;
  shortenedPauseMs: number;
}

const defaultPolicy: LiveBatchPlanningPolicy = {
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

function regionDuration(region: TimelineRegionDraft) {
  return region.endMs - region.startMs;
}

function totalDuration(regions: TimelineRegionDraft[]) {
  return regions.reduce((total, region) => total + regionDuration(region), 0);
}

function rangesOverlap(
  left: Pick<PlannedBatchSourceRange, 'sourceStartMs' | 'sourceEndMs'>,
  right: Pick<PlannedBatchSourceRange, 'sourceStartMs' | 'sourceEndMs'>,
) {
  return left.sourceStartMs < right.sourceEndMs && right.sourceStartMs < left.sourceEndMs;
}

function sourceDurationMs(ranges: PlannedBatchSourceRange[]) {
  if (ranges.length === 0) {
    return 0;
  }

  const startMs = Math.min(...ranges.map((range) => range.sourceStartMs));
  const endMs = Math.max(...ranges.map((range) => range.sourceEndMs));
  return endMs - startMs;
}

export class LiveBatchPlanner {
  private readonly policy: LiveBatchPlanningPolicy;
  private readonly sessionId: string;
  private readonly createdLive: boolean;
  private currentBatchId = createBatchId();
  private currentRanges: PlannedBatchSourceRange[] = [];
  private currentDerivedMs = 0;
  private nextBatchSequence = 0;
  private pendingPauseRegions: TimelineRegionDraft[] = [];
  private leadingPauseAlreadyEmitted = false;
  private readonly emittedRanges: PlannedBatchSourceRange[] = [];

  constructor(options: {
    sessionId: string;
    createdLive: boolean;
    policy?: Partial<LiveBatchPlanningPolicy>;
  }) {
    this.sessionId = options.sessionId;
    this.createdLive = options.createdLive;
    this.policy = { ...defaultPolicy, ...options.policy };
  }

  appendRegions(regions: TimelineRegionDraft[]): PlannedTranscriptionBatch[] {
    const batches: PlannedTranscriptionBatch[] = [];
    for (const region of regions) {
      if (region.kind === 'speech') {
        this.appendPendingPauseBeforeSpeech();
        this.appendRange({
          timelineRegionId: region.id,
          sourceStartMs: region.startMs,
          sourceEndMs: region.endMs,
          reason: 'speech',
        });
        this.pendingPauseRegions = [];
        this.leadingPauseAlreadyEmitted = false;
        continue;
      }

      this.pendingPauseRegions.push(region);
      const batch = this.maybeFlushAtLongPauseBoundary();
      if (batch) {
        batches.push(batch);
      }
    }

    return batches;
  }

  flush(): PlannedTranscriptionBatch[] {
    if (this.currentRanges.length === 0) {
      this.pendingPauseRegions = [];
      return [];
    }

    if (this.pendingPauseRegions.length > 0 && !this.leadingPauseAlreadyEmitted) {
      this.appendLeadingPauseBuffer();
    }

    const batch = this.flushCurrentBatch();
    this.pendingPauseRegions = [];
    return batch ? [batch] : [];
  }

  private appendPendingPauseBeforeSpeech() {
    if (this.pendingPauseRegions.length === 0) {
      return;
    }

    const durationMs = totalDuration(this.pendingPauseRegions);
    if (this.currentRanges.length === 0) {
      this.appendTrailingPauseBuffer();
      return;
    }

    if (durationMs <= this.policy.longPauseThresholdMs) {
      for (const region of this.pendingPauseRegions) {
        this.appendRange({
          timelineRegionId: region.id,
          sourceStartMs: region.startMs,
          sourceEndMs: region.endMs,
          reason: 'normal_pause',
        });
      }
      return;
    }

    this.appendLeadingPauseBuffer();
    this.appendTrailingPauseBuffer();
  }

  private maybeFlushAtLongPauseBoundary() {
    if (
      this.currentRanges.length === 0 ||
      this.leadingPauseAlreadyEmitted ||
      this.currentDerivedMs < this.policy.preferredMinDerivedBatchMs ||
      totalDuration(this.pendingPauseRegions) < this.policy.shortenedPauseMs
    ) {
      return null;
    }

    this.appendLeadingPauseBuffer();
    this.leadingPauseAlreadyEmitted = true;
    return this.flushCurrentBatch();
  }

  private appendLeadingPauseBuffer() {
    let remainingMs = this.policy.shortenedPauseMs;
    for (const region of this.pendingPauseRegions) {
      if (remainingMs <= 0) {
        return;
      }

      const sourceEndMs = Math.min(region.endMs, region.startMs + remainingMs);
      this.appendRange({
        timelineRegionId: region.id,
        sourceStartMs: region.startMs,
        sourceEndMs,
        reason: 'pause_buffer',
      });
      remainingMs -= sourceEndMs - region.startMs;
    }
  }

  private appendTrailingPauseBuffer() {
    // Walk backwards to pick the pause closest to the upcoming speech, then append
    // chronologically so the derived audio plays in source order.
    const trailingRanges: { region: TimelineRegionDraft; sourceStartMs: number }[] = [];
    let remainingMs = this.policy.shortenedPauseMs;
    for (const region of [...this.pendingPauseRegions].reverse()) {
      if (remainingMs <= 0) {
        break;
      }

      const sourceStartMs = Math.max(region.startMs, region.endMs - remainingMs);
      trailingRanges.unshift({ region, sourceStartMs });
      remainingMs -= region.endMs - sourceStartMs;
    }

    for (const { region, sourceStartMs } of trailingRanges) {
      this.appendRange({
        timelineRegionId: region.id,
        sourceStartMs,
        sourceEndMs: region.endMs,
        reason: 'pause_buffer',
      });
    }
  }

  private appendRange(options: {
    timelineRegionId: string | null;
    sourceStartMs: number;
    sourceEndMs: number;
    reason: PlannedBatchSourceRange['reason'];
  }) {
    if (options.sourceEndMs <= options.sourceStartMs) {
      return;
    }

    const candidate = {
      sourceStartMs: options.sourceStartMs,
      sourceEndMs: options.sourceEndMs,
    };
    if (this.emittedRanges.some((range) => rangesOverlap(range, candidate))) {
      return;
    }
    if (this.currentRanges.some((range) => rangesOverlap(range, candidate))) {
      return;
    }

    const durationMs = options.sourceEndMs - options.sourceStartMs;
    this.currentRanges.push({
      id: createRangeId(),
      batchId: this.currentBatchId,
      timelineRegionId: options.timelineRegionId,
      sequence: this.currentRanges.length,
      sourceStartMs: options.sourceStartMs,
      sourceEndMs: options.sourceEndMs,
      derivedStartMs: this.currentDerivedMs,
      derivedEndMs: this.currentDerivedMs + durationMs,
      reason: options.reason,
    });
    this.currentDerivedMs += durationMs;
  }

  private flushCurrentBatch() {
    if (this.currentRanges.length === 0) {
      return null;
    }

    const batch: PlannedTranscriptionBatch = {
      id: this.currentBatchId,
      sessionId: this.sessionId,
      sequence: this.nextBatchSequence++,
      sourceDurationMs: sourceDurationMs(this.currentRanges),
      derivedAudioDurationMs: this.currentDerivedMs,
      createdLive: this.createdLive,
      sourceRanges: this.currentRanges,
    };

    this.emittedRanges.push(...this.currentRanges);
    this.currentBatchId = createBatchId();
    this.currentRanges = [];
    this.currentDerivedMs = 0;
    return batch;
  }
}
