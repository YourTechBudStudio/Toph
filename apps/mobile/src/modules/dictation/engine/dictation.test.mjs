/**
 * The recording lifecycle's ordering rules, with a hand-driven fake of the native module and the
 * real segmentation and transcription:
 * - `stop()` and `discard()` settle only after the native final event has been handled, the
 *   listener is removed, uploads have settled or been aborted, and the session folder is deleted;
 * - nothing is uploaded after a Discard, even for a cut that was already in flight;
 * - a failed start releases what it took.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { startDictation } from './dictation.ts';
import {
  LIVE_BATCH_PATTERN,
  SHORT_SPEECH_PATTERN,
  createFakeHost,
  framesEvent,
  jsonResponse,
  scoredFrames,
  settle,
  stubFetch,
  testConfig,
  track,
  waitFor,
} from './test-support.mjs';

/** A final event carrying a short utterance, which the planner turns into one batch. */
const finalSpeechEvent = () => framesEvent(scoredFrames(SHORT_SPEECH_PATTERN), { final: true });
const emptyFinalEvent = () => framesEvent([], { final: true });

let fetchStub = null;
beforeEach(() => {
  mock.method(console, 'log', () => {});
  mock.method(console, 'warn', () => {});
});
afterEach(() => {
  fetchStub?.restore();
  fetchStub = null;
  mock.restoreAll();
});

describe('startDictation', () => {
  it('stop waits for the final event, not for stopCapture', async () => {
    fetchStub = stubFetch(() => jsonResponse(200, { text: 'Hello there.' }));
    const fake = createFakeHost();
    const run = await startDictation(testConfig, fake.host);

    const stopped = track(run.stop());
    await waitFor(() => fake.calls.stopCapture.length === 1, 'stopCapture');
    fake.calls.stopCapture[0].resolve();
    await settle();
    assert.equal(stopped.settled, false, 'stop() settled before the final event');
    assert.equal(fake.listenerCount, 1);

    fake.emit(finalSpeechEvent());
    await waitFor(() => stopped.settled, 'stop to settle');
    assert.deepEqual(stopped.value, { kind: 'transcript', text: 'Hello there.' });
    assert.equal(fake.listenerCount, 0);
    assert.equal(fake.calls.deletedFolders, 1);
  });

  it("a pending cut of the final event's batch holds stop", async () => {
    fetchStub = stubFetch(() => jsonResponse(200, { text: 'Hello.' }));
    const fake = createFakeHost();
    fake.autoResolve.cutBatch = false;
    const run = await startDictation(testConfig, fake.host);

    const stopped = track(run.stop());
    fake.emit(finalSpeechEvent());
    await waitFor(() => fake.calls.stopCapture.length === 1, 'stopCapture');
    fake.calls.stopCapture[0].resolve();
    await waitFor(() => fake.calls.cutBatch.length === 1, 'the cut');
    await settle();
    assert.equal(stopped.settled, false);
    assert.equal(fetchStub.requests.length, 0, 'uploaded before the batch was cut');
    assert.equal(fake.calls.deletedFolders, 0, 'deleted the folder during a cut');

    fake.calls.cutBatch[0].resolve();
    await waitFor(() => stopped.settled, 'stop to settle');
    assert.deepEqual(stopped.value, { kind: 'transcript', text: 'Hello.' });
    assert.equal(fetchStub.requests.length, 1);
    assert.equal(fake.calls.deletedFolders, 1);
  });

  it('discard uploads nothing from the final event and releases everything', async () => {
    fetchStub = stubFetch(() => jsonResponse(200, { text: 'Hello.' }));
    const fake = createFakeHost();
    const run = await startDictation(testConfig, fake.host);

    const discarded = track(run.discard());
    await waitFor(() => fake.calls.stopCapture.length === 1, 'stopCapture');
    fake.calls.stopCapture[0].resolve();
    await settle();
    assert.equal(discarded.settled, false, 'discard() settled before the final event');

    fake.emit(finalSpeechEvent());
    await waitFor(() => discarded.settled, 'discard to settle');
    assert.equal(discarded.error, undefined);
    assert.equal(fake.calls.cutBatch.length, 0);
    assert.equal(fetchStub.requests.length, 0);
    assert.equal(fake.listenerCount, 0);
    assert.equal(fake.calls.deletedFolders, 1);
  });

  it('discard during a pending live cut schedules no upload', async () => {
    fetchStub = stubFetch(() => jsonResponse(200, { text: 'Hello.' }));
    const fake = createFakeHost();
    fake.autoResolve.cutBatch = false;
    const run = await startDictation(testConfig, fake.host);

    fake.emit(framesEvent(scoredFrames(LIVE_BATCH_PATTERN)));
    await waitFor(() => fake.calls.cutBatch.length === 1, 'the live cut');

    const discarded = track(run.discard());
    await waitFor(() => fake.calls.stopCapture.length === 1, 'stopCapture');
    fake.calls.stopCapture[0].resolve();
    fake.emit(emptyFinalEvent());
    await settle();
    assert.equal(discarded.settled, false, 'discard() settled while the cut was pending');

    fake.calls.cutBatch[0].resolve();
    await waitFor(() => discarded.settled, 'discard to settle');
    assert.equal(fetchStub.requests.length, 0);
    assert.equal(fake.listenerCount, 0);
    assert.equal(fake.calls.deletedFolders, 1);
  });

  it('a failed start rejects after removing the listener and deleting the folder', async () => {
    const fake = createFakeHost();
    fake.autoResolve.startCapture = false;
    const started = track(startDictation(testConfig, fake.host));
    await waitFor(() => fake.calls.startCapture.length === 1, 'startCapture');
    assert.equal(fake.listenerCount, 1, 'the listener is added before capture starts');

    fake.calls.startCapture[0].reject(new Error('The microphone could not be started.'));
    await waitFor(() => started.settled, 'start to settle');
    assert.equal(started.error?.message, 'The microphone could not be started.');
    assert.equal(fake.listenerCount, 0);
    assert.equal(fake.calls.deletedFolders, 1);
  });

  it('a stopCapture that rejects fails the run and aborts uploads in flight', async () => {
    // Broken native contract: stopCapture rejects, so no final event will come.
    fetchStub = stubFetch(() => new Promise(() => {})); // only the abort ends it
    const fake = createFakeHost();
    const run = await startDictation(testConfig, fake.host);

    fake.emit(framesEvent(scoredFrames(LIVE_BATCH_PATTERN)));
    await waitFor(() => fetchStub.requests.length === 1, 'the live upload');

    const stopped = track(run.stop());
    await waitFor(() => fake.calls.stopCapture.length === 1, 'stopCapture');
    fake.calls.stopCapture[0].reject(new Error('Native stop failed.'));
    await waitFor(() => stopped.settled, 'stop to settle');

    assert.deepEqual(stopped.value, { kind: 'failed', message: 'Native stop failed.' });
    assert.equal(fetchStub.requests[0].init.signal.aborted, true);
    assert.equal(fake.listenerCount, 0);
    assert.equal(fake.calls.deletedFolders, 1);
  });

  it('a capture error on the final event fails the run', async () => {
    fetchStub = stubFetch(() => jsonResponse(200, { text: 'Hello.' }));
    const fake = createFakeHost();
    const run = await startDictation(testConfig, fake.host);

    const stopped = track(run.stop());
    await waitFor(() => fake.calls.stopCapture.length === 1, 'stopCapture');
    fake.emit(framesEvent([], { final: true, error: 'Microphone read failed (code -3).' }));
    fake.calls.stopCapture[0].resolve();
    await waitFor(() => stopped.settled, 'stop to settle');

    assert.deepEqual(stopped.value, {
      kind: 'failed',
      message: 'Recording failed: Microphone read failed (code -3).',
    });
    assert.equal(fetchStub.requests.length, 0);
    assert.equal(fake.calls.deletedFolders, 1);
  });
});
