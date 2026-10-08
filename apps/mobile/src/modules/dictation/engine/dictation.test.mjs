/**
 * The recording lifecycle's ordering rules, with a hand-driven fake of the native module and the
 * real segmentation and transcription:
 * - `stop()` and `discard()` settle only after the native final event has been handled, the
 *   listener is removed, uploads have settled or been aborted, and the session folder is deleted;
 * - nothing is uploaded after a Discard, even for a cut that was already in flight;
 * - a failed start releases what it took;
 * - `oneDictationAtATime` lets one run hold the device until its start fails or its end settles.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { oneDictationAtATime, startDictation } from './dictation.ts';
import {
  LIVE_BATCH_PATTERN,
  SHORT_SPEECH_PATTERN,
  createFakeHost,
  framesEvent,
  jsonResponse,
  scoredFrames,
  settle,
  stubFetch,
  deferred,
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

describe('oneDictationAtATime', () => {
  const STILL_FINISHING = 'Another dictation is still finishing.';
  const guarded = (fake) => oneDictationAtATime((config) => startDictation(config, fake.host));

  it('holds through a final event that arrives after stopCapture resolved', async () => {
    fetchStub = stubFetch(() => jsonResponse(200, { text: 'Second.' }));
    const fake = createFakeHost();
    const start = guarded(fake);
    const first = await start(testConfig);

    const firstStopped = track(first.stop());
    await waitFor(() => fake.calls.stopCapture.length === 1, 'stopCapture');
    fake.calls.stopCapture[0].resolve(); // native has freed the mic; its final event is still on the way
    await settle();

    await assert.rejects(start(testConfig), { message: STILL_FINISHING });
    assert.equal(fake.calls.startCapture.length, 1);
    assert.equal(fake.listenerCount, 1);

    fake.emit(framesEvent([], { final: true, error: 'Microphone read failed (code -3).' }));
    await waitFor(() => firstStopped.settled, 'the first stop to settle');
    assert.deepEqual(firstStopped.value, {
      kind: 'failed',
      message: 'Recording failed: Microphone read failed (code -3).',
    });

    const second = await start(testConfig);
    assert.equal(fake.calls.startCapture.length, 2);
    assert.equal(fake.listenerCount, 1);
    const secondStopped = track(second.stop());
    await waitFor(() => fake.calls.stopCapture.length === 2, 'the second stopCapture');
    fake.emit(finalSpeechEvent());
    fake.calls.stopCapture[1].resolve();
    await waitFor(() => secondStopped.settled, 'the second stop to settle');
    assert.deepEqual(secondStopped.value, { kind: 'transcript', text: 'Second.' });
  });

  it('a failed start releases the hold', async () => {
    const fake = createFakeHost();
    fake.autoResolve.startCapture = false;
    const start = guarded(fake);

    const first = start(testConfig);
    await waitFor(() => fake.calls.startCapture.length === 1, 'startCapture');
    fake.calls.startCapture[0].reject(new Error('Microphone busy.'));
    await assert.rejects(first, { message: 'Microphone busy.' });

    const second = start(testConfig);
    await waitFor(() => fake.calls.startCapture.length === 2, 'the second startCapture');
    fake.calls.startCapture[1].resolve();
    await second;
  });

  it('discard releases the hold once it settles', async () => {
    const fake = createFakeHost();
    const start = guarded(fake);
    const run = await start(testConfig);

    const discarded = track(run.discard());
    await waitFor(() => fake.calls.stopCapture.length === 1, 'stopCapture');
    fake.calls.stopCapture[0].resolve();
    await settle();
    await assert.rejects(start(testConfig), { message: STILL_FINISHING });

    fake.emit(emptyFinalEvent());
    await waitFor(() => discarded.settled, 'discard to settle');
    await start(testConfig);
    assert.equal(fake.calls.startCapture.length, 2);
  });

  it('holds while the last upload is still in flight', async () => {
    const upload = deferred();
    fetchStub = stubFetch(() => upload.promise);
    const fake = createFakeHost();
    const start = guarded(fake);
    const run = await start(testConfig);

    const stopped = track(run.stop());
    await waitFor(() => fake.calls.stopCapture.length === 1, 'stopCapture');
    fake.emit(finalSpeechEvent());
    fake.calls.stopCapture[0].resolve();
    await waitFor(() => fetchStub.requests.length === 1, 'the upload');
    assert.equal(fake.listenerCount, 0);
    await assert.rejects(start(testConfig), { message: STILL_FINISHING });

    upload.resolve(jsonResponse(200, { text: 'Done.' }));
    await waitFor(() => stopped.settled, 'stop to settle');
    assert.deepEqual(stopped.value, { kind: 'transcript', text: 'Done.' });
    await start(testConfig);
    assert.equal(fake.calls.startCapture.length, 2);
  });
});
