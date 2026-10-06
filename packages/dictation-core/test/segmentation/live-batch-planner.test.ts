import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LiveBatchPlanner } from '../../src/segmentation/live-batch-planner.ts';
import type {
  PlannedTranscriptionBatch,
  TimelineRegionDraft,
} from '../../src/segmentation/types.ts';

function region(
  sequence: number,
  kind: TimelineRegionDraft['kind'],
  startMs: number,
  endMs: number,
): TimelineRegionDraft {
  return {
    id: `region_${sequence}`,
    sequence,
    kind,
    startMs,
    endMs,
    confidence: null,
    createdLive: true,
  };
}

function allRanges(batches: PlannedTranscriptionBatch[]) {
  return batches.flatMap((batch) => batch.sourceRanges);
}

function assertNoOverlappingRanges(batches: PlannedTranscriptionBatch[]) {
  const ranges = allRanges(batches);
  for (let leftIndex = 0; leftIndex < ranges.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < ranges.length; rightIndex += 1) {
      const left = ranges[leftIndex];
      const right = ranges[rightIndex];
      assert.ok(
        left.sourceStartMs >= right.sourceEndMs || right.sourceStartMs >= left.sourceEndMs,
        `ranges overlap: ${left.sourceStartMs}-${left.sourceEndMs} and ${right.sourceStartMs}-${right.sourceEndMs}`,
      );
    }
  }
}

describe('LiveBatchPlanner', () => {
  it('does not force-cut continuous speech before stop', () => {
    const planner = new LiveBatchPlanner({ sessionId: 'session', createdLive: true });

    const liveBatches = planner.appendRegions([region(0, 'speech', 0, 30_000)]);
    assert.equal(liveBatches.length, 0);

    const finalBatches = planner.flush();
    assert.equal(finalBatches.length, 1);
    assert.equal(finalBatches[0].sourceRanges[0].sourceStartMs, 0);
    assert.equal(finalBatches[0].sourceRanges[0].sourceEndMs, 30_000);
  });

  it('flushes a final short speech batch on stop', () => {
    const planner = new LiveBatchPlanner({ sessionId: 'session', createdLive: true });

    assert.equal(planner.appendRegions([region(0, 'speech', 0, 2_000)]).length, 0);

    const finalBatches = planner.flush();
    assert.equal(finalBatches.length, 1);
    assert.equal(finalBatches[0].derivedAudioDurationMs, 2_000);
  });

  it('emits a leading pause buffer during a long pause once the preferred duration is reached', () => {
    const planner = new LiveBatchPlanner({ sessionId: 'session', createdLive: true });

    assert.equal(planner.appendRegions([region(0, 'speech', 0, 10_000)]).length, 0);
    const liveBatches = planner.appendRegions([region(1, 'silence', 10_000, 10_500)]);

    assert.equal(liveBatches.length, 1);
    assert.equal(liveBatches[0].derivedAudioDurationMs, 10_500);
    assert.deepEqual(
      liveBatches[0].sourceRanges.map((range) => range.reason),
      ['speech', 'pause_buffer'],
    );
  });

  it('can include a trailing pause buffer when speech resumes after an emitted long pause', () => {
    const planner = new LiveBatchPlanner({ sessionId: 'session', createdLive: true });
    const batches: PlannedTranscriptionBatch[] = [];

    batches.push(...planner.appendRegions([region(0, 'speech', 0, 10_000)]));
    batches.push(...planner.appendRegions([region(1, 'silence', 10_000, 10_500)]));
    batches.push(...planner.appendRegions([region(2, 'silence', 10_500, 15_000)]));
    batches.push(...planner.appendRegions([region(3, 'speech', 15_000, 17_000)]));
    batches.push(...planner.flush());

    assert.equal(batches.length, 2);
    assertNoOverlappingRanges(batches);
    assert.deepEqual(
      batches[1].sourceRanges.map((range) => range.reason),
      ['pause_buffer', 'speech'],
    );
    assert.equal(batches[1].sourceRanges[0].sourceStartMs, 14_500);
    assert.equal(batches[1].sourceRanges[0].sourceEndMs, 15_000);
  });

  it('keeps a trailing pause buffer spanning several pause regions in source order', () => {
    const planner = new LiveBatchPlanner({ sessionId: 'session', createdLive: true });

    planner.appendRegions([
      region(0, 'silence', 0, 300),
      region(1, 'silence', 300, 600),
      region(2, 'speech', 600, 2_000),
    ]);
    const [batch] = planner.flush();

    assert.deepEqual(
      batch.sourceRanges.map((range) => [range.sourceStartMs, range.sourceEndMs, range.reason]),
      [
        [100, 300, 'pause_buffer'],
        [300, 600, 'pause_buffer'],
        [600, 2_000, 'speech'],
      ],
    );
    assert.deepEqual(
      batch.sourceRanges.map((range) => [range.derivedStartMs, range.derivedEndMs]),
      [
        [0, 200],
        [200, 500],
        [500, 1_900],
      ],
    );
  });

  it('does not produce batches for silence-only input', () => {
    const planner = new LiveBatchPlanner({ sessionId: 'session', createdLive: true });

    assert.equal(planner.appendRegions([region(0, 'silence', 0, 5_000)]).length, 0);
    assert.equal(planner.flush().length, 0);
  });
});
