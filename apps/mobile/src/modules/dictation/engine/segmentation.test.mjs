/**
 * Mobile segments Silero frames exactly as desktop does: desktop's ms rounding, desktop's
 * assembler → planner → flush order, and results that do not depend on how frames are grouped into
 * native events.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LiveBatchPlanner, TimelineAssembler } from '@toph/dictation-core';

import { createSegmentationRun, toProbabilityFrames } from './segmentation.ts';
import {
  LIVE_BATCH_PATTERN,
  SHORT_SPEECH_PATTERN,
  framesEvent,
  scoredFrames,
} from './test-support.mjs';

// Ids are random; everything else must match.
const withoutIds = ({ regions, batches }) => ({
  regions: regions.map(({ id: _id, ...region }) => region),
  batches: batches.map(({ id: _id, sourceRanges, ...batch }) => ({
    ...batch,
    sourceRanges: sourceRanges.map(
      ({ id: _rangeId, batchId: _batchId, timelineRegionId: _regionId, ...range }) => range,
    ),
  })),
});

const RECORDING = [...LIVE_BATCH_PATTERN, ...SHORT_SPEECH_PATTERN, { ms: 1_000, p: 0.9 }];

/** The recording's frames plus a short tail, as the final event of a capture would carry it. */
function recordingFrames() {
  const frames = scoredFrames(RECORDING);
  const end = frames.at(-1).end;
  return { live: frames, tail: [{ start: end, end: end + 200, probability: 0.9 }] };
}

function runEvents(events) {
  const run = createSegmentationRun('session');
  const batches = [];
  for (const event of events) {
    batches.push(...(event.final ? run.finish(event) : run.push(event)));
  }
  return { regions: [...run.regions], batches };
}

describe('toProbabilityFrames', () => {
  it('converts sample offsets to ms with desktop rounding', () => {
    const frames = toProbabilityFrames(
      framesEvent([
        { start: 0, end: 512, probability: 0.1 },
        { start: 1024, end: 1536, probability: 0.2 },
        { start: 15_872, end: 16_001, probability: 0.3 },
      ]),
    );
    assert.deepEqual(frames, [
      { startMs: 0, endMs: 32, speechProbability: 0.1 },
      { startMs: 64, endMs: 96, speechProbability: 0.2 },
      { startMs: 992, endMs: 1000, speechProbability: 0.3 },
    ]);
  });

  it('drops a tail frame that rounds to zero length', () => {
    const frames = toProbabilityFrames(
      framesEvent([
        { start: 15_488, end: 16_000, probability: 0.4 },
        { start: 16_000, end: 16_007, probability: 0.5 },
      ]),
    );
    assert.deepEqual(frames, [{ startMs: 968, endMs: 1000, speechProbability: 0.4 }]);
  });
});

describe('createSegmentationRun', () => {
  it('gives the same regions and batches as desktop order over the core directly', () => {
    const { live, tail } = recordingFrames();
    const liveEvent = framesEvent(live);
    const finalEvent = framesEvent(tail, { final: true });

    const assembler = new TimelineAssembler({ createdLive: true });
    const planner = new LiveBatchPlanner({ sessionId: 'session', createdLive: true });
    const expected = { regions: [], batches: [] };
    const append = (regions) => {
      expected.regions.push(...regions);
      expected.batches.push(...planner.appendRegions(regions));
    };
    // segmentation-pipeline-session.ts: processPcmChunk, then flush.
    append(assembler.processFrames(toProbabilityFrames(liveEvent)));
    append(assembler.processFrames(toProbabilityFrames(finalEvent)));
    append(assembler.flush());
    expected.batches.push(...planner.flush());

    const actual = runEvents([liveEvent, finalEvent]);
    assert.deepEqual(withoutIds(actual), withoutIds(expected));
    // The recording has a live batch and a final one, so both paths are exercised.
    assert.equal(actual.batches.length, 2);
  });

  it('does not depend on how frames are grouped into events', () => {
    const { live, tail } = recordingFrames();
    const oneFramePerEvent = [
      ...live.map((frame) => framesEvent([frame])),
      framesEvent(tail, { final: true }),
    ];
    const oneBigEvent = [framesEvent([...live, ...tail], { final: true })];

    assert.deepEqual(withoutIds(runEvents(oneFramePerEvent)), withoutIds(runEvents(oneBigEvent)));
  });

  it('plans a live batch at a pause, before the final event', () => {
    const run = createSegmentationRun('session');
    const batches = run.push(framesEvent(scoredFrames(LIVE_BATCH_PATTERN)));
    assert.equal(batches.length, 1);
    assert.equal(batches[0].sequence, 0);
    assert.equal(batches[0].createdLive, true);
  });
});
