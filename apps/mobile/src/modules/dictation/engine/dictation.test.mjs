/**
 * The recording lifecycle's ordering rules, with a hand-driven fake of the native module and the
 * real segmentation and transcription:
 * - `stop()` and `discard()` settle only after the native final event has been handled, the
 *   listener is removed, uploads have settled or been aborted, and `batches/` (stop) or the whole
 *   session folder (discard) is deleted;
 * - nothing is uploaded after a Discard, even for a cut that was already in flight;
 * - a failed start releases what it took;
 * - `oneDictationAtATime` lets one run hold the device until its start fails or its end settles;
 * - each run is saved as desktop saves it: the row before capture, then the outcome, the raw and
 *   polished outputs and the selection, with required writes failing the run and ancillary steps
 *   only logged; polish chunks are aborted and awaited before the run settles.
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
  mock.method(console, 'error', () => {});
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
    assert.equal(fake.calls.deletedBatches, 1);
    assert.equal(fake.calls.deletedFolders, 0);
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
    assert.equal(fake.calls.deletedBatches, 0, 'deleted the batches during a cut');

    fake.calls.cutBatch[0].resolve();
    await waitFor(() => stopped.settled, 'stop to settle');
    assert.deepEqual(stopped.value, { kind: 'transcript', text: 'Hello.' });
    assert.equal(fetchStub.requests.length, 1);
    assert.equal(fake.calls.deletedBatches, 1);
    assert.equal(fake.calls.deletedFolders, 0);
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
    assert.equal(fake.calls.deletedBatches, 1);
    assert.equal(fake.calls.deletedFolders, 0);
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
    assert.equal(fake.calls.deletedBatches, 1);
    assert.equal(fake.calls.deletedFolders, 0);
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

/** Stops `run`, lets native end capture with `finalEvent`, and returns the outcome. Fails if stop rejects. */
async function stopWith(fake, run, finalEvent, options) {
  const stopped = track(run.stop(options));
  await waitFor(() => fake.calls.stopCapture.length > 0, 'stopCapture');
  fake.emit(finalEvent);
  fake.calls.stopCapture.at(-1).resolve();
  await waitFor(() => stopped.settled, 'stop to settle');
  assert.equal(stopped.error, undefined, 'stop() rejected');
  return stopped.value;
}

const POLISH_FAILED = 'Polish failed unexpectedly. Raw text saved in Toph history.';
/** Over core's 1,200-character chunk threshold, so one live batch starts an incremental chunk. */
const LONG_TEXT = `${'This is a long sentence that keeps going. '.repeat(32).trim()}`;

describe('saving to history', () => {
  it('(1) polish off: saves the row, the raw output and its selection, then keeps raw.wav and prunes', async () => {
    fetchStub = stubFetch(() => jsonResponse(200, { text: 'Hello there.' }));
    const fake = createFakeHost();
    const run = await startDictation(testConfig, fake.host);
    const outcome = await stopWith(fake, run, finalSpeechEvent());

    assert.deepEqual(outcome, { kind: 'transcript', text: 'Hello there.' });
    assert.deepEqual(fake.records.names, [
      'ready',
      'createRecordingSession',
      'markRecorded',
      'createSessionOutput',
      'selectSessionOutput',
      'pruneAndRefresh',
    ]);
    const [session] = fake.records.argumentsOf('createRecordingSession');
    assert.match(session.id, /^session_\d+_/u);
    assert.equal(session.rawAudioPath, `recordings/${session.id}/raw.wav`);
    assert.equal(session.transcriptionModel, testConfig.transcriptionModel);
    const [raw] = fake.records.outputs;
    assert.equal(raw.kind, 'raw_concat');
    assert.equal(raw.text, 'Hello there.');
    assert.deepEqual(fake.records.argumentsOf('selectSessionOutput'), [
      { sessionId: session.id, outputId: raw.id },
    ]);
    assert.equal(fake.calls.deletedBatches, 1);
    assert.equal(fake.calls.deletedFolders, 0);
    assert.equal(fetchStub.inferenceRequests.length, 0);
  });

  it('(2) polish on: returns the polished text and selects the polished output', async () => {
    fetchStub = stubFetch(() => jsonResponse(200, { text: 'hello there' }));
    const fake = createFakeHost();
    fake.polish.enabled = true;
    const run = await startDictation(testConfig, fake.host);
    const outcome = await stopWith(fake, run, finalSpeechEvent());

    assert.deepEqual(outcome, { kind: 'transcript', text: 'Polished text.' });
    assert.equal(fetchStub.inferenceRequests.length, 1);
    const [raw, polished] = fake.records.outputs;
    assert.equal(raw.kind, 'raw_concat');
    assert.equal(polished.kind, 'polished');
    assert.equal(polished.sourceOutputId, raw.id);
    assert.equal(polished.rulePresetId, 'preset-test');
    assert.deepEqual(
      fake.records.argumentsOf('selectSessionOutput').map(({ outputId }) => outputId),
      [polished.id],
    );
    assert.equal(fake.records.argumentsOf('markFailed').length, 0);
  });

  it('(3, 14) a polish failure keeps the raw output unselected and says where the text went', async () => {
    fetchStub = stubFetch(
      () => jsonResponse(200, { text: 'hello there' }),
      () => jsonResponse(400, { error: { message: 'model not found' } }),
    );
    const fake = createFakeHost();
    fake.polish.enabled = true;
    const run = await startDictation(testConfig, fake.host);
    const outcome = await stopWith(fake, run, finalSpeechEvent());

    assert.equal(outcome.kind, 'failed');
    assert.ok(outcome.message.startsWith(`${POLISH_FAILED} `), outcome.message);
    assert.ok(!outcome.message.endsWith('.'), 'a trailing period would break splitErrorDetail');
    assert.deepEqual(
      fake.records.outputs.map(({ kind }) => kind),
      ['raw_concat'],
    );
    assert.equal(fake.records.argumentsOf('selectSessionOutput').length, 0);
    assert.deepEqual(fake.records.argumentsOf('markFailed').at(-1), {
      sessionId: fake.records.argumentsOf('createRecordingSession')[0].id,
      errorMessage: outcome.message,
    });
    assert.equal(fake.calls.deletedBatches, 1);
  });

  it('(4) no speech and a failed batch are saved as such', async () => {
    fetchStub = stubFetch(() => jsonResponse(400, { error: { message: 'bad audio' } }));
    const silent = createFakeHost();
    const silentRun = await startDictation(testConfig, silent.host);
    assert.deepEqual(await stopWith(silent, silentRun, emptyFinalEvent()), { kind: 'no_speech' });
    assert.equal(silent.records.argumentsOf('markNoSpeech').length, 1);
    assert.equal(silent.records.outputs.length, 0);

    const failing = createFakeHost();
    const failingRun = await startDictation(testConfig, failing.host);
    const outcome = await stopWith(failing, failingRun, finalSpeechEvent());
    assert.equal(outcome.kind, 'failed');
    assert.equal(failing.records.argumentsOf('markFailed')[0].errorMessage, outcome.message);
    assert.equal(failing.records.outputs.length, 0);
  });

  it('(5) unusable storage refuses the start before anything is taken', async () => {
    const database = createFakeHost();
    database.records.failOn.add('ready');
    await assert.rejects(startDictation(testConfig, database.host), { message: 'ready failed.' });

    const polish = createFakeHost();
    polish.host.polish.ready = async () => {
      throw new Error('Polish storage is unavailable.');
    };
    await assert.rejects(startDictation(testConfig, polish.host), {
      message: 'Polish storage is unavailable.',
    });

    for (const fake of [database, polish]) {
      assert.equal(fake.calls.createdFolders, 0);
      assert.equal(fake.calls.startCapture.length, 0);
      assert.equal(fake.records.argumentsOf('createRecordingSession').length, 0);
    }
  });

  it('(6) a failed row insert refuses the start before the mic opens', async () => {
    const fake = createFakeHost();
    fake.records.failOn.add('createRecordingSession');
    await assert.rejects(startDictation(testConfig, fake.host), {
      message: 'createRecordingSession failed.',
    });
    assert.equal(fake.calls.deletedFolders, 1);
    assert.equal(fake.calls.startCapture.length, 0);
    assert.equal(fake.listenerCount, 0);
  });

  it('(7) a failed capture start deletes the folder and marks the row cancelled', async () => {
    const fake = createFakeHost();
    fake.autoResolve.startCapture = false;
    const started = track(startDictation(testConfig, fake.host));
    await waitFor(() => fake.calls.startCapture.length === 1, 'startCapture');
    fake.calls.startCapture[0].reject(new Error('Microphone busy.'));
    await waitFor(() => started.settled, 'start to settle');

    assert.equal(started.error?.message, 'Microphone busy.');
    assert.equal(fake.calls.deletedFolders, 1);
    assert.equal(fake.listenerCount, 0);
    assert.deepEqual(fake.records.names, ['ready', 'createRecordingSession', 'markCancelled']);
  });

  it('(8) a failed required write fails the run, cancels transcription and delivers no text', async () => {
    fetchStub = stubFetch(() => new Promise(() => {})); // only the abort ends it
    const fake = createFakeHost();
    fake.records.failOn.add('markRecorded');
    const run = await startDictation(testConfig, fake.host);
    fake.emit(framesEvent(scoredFrames(LIVE_BATCH_PATTERN)));
    await waitFor(() => fetchStub.requests.length === 1, 'the live upload');

    const outcome = await stopWith(fake, run, emptyFinalEvent());
    assert.deepEqual(outcome, {
      kind: 'failed',
      message: "Couldn't save this dictation. markRecorded failed.",
    });
    assert.equal(fetchStub.requests[0].init.signal.aborted, true);
    assert.deepEqual(fake.records.argumentsOf('markFailed').at(-1).errorMessage, outcome.message);
    assert.equal(fake.records.outputs.length, 0);
    assert.equal(fake.calls.deletedBatches, 1);
    assert.equal(fake.records.argumentsOf('pruneAndRefresh').length, 1);
  });

  it('(9) a failed prune leaves a successful outcome unchanged', async () => {
    fetchStub = stubFetch(() => jsonResponse(200, { text: 'Hello.' }));
    const fake = createFakeHost();
    fake.records.failOn.add('pruneAndRefresh');
    const run = await startDictation(testConfig, fake.host);
    assert.deepEqual(await stopWith(fake, run, finalSpeechEvent()), {
      kind: 'transcript',
      text: 'Hello.',
    });
  });

  it('(10) discard deletes the folder and marks the row cancelled', async () => {
    const fake = createFakeHost();
    fake.records.failOn.add('markCancelled'); // logged only
    const run = await startDictation(testConfig, fake.host);
    const discarded = track(run.discard());
    await waitFor(() => fake.calls.stopCapture.length === 1, 'stopCapture');
    fake.calls.stopCapture[0].resolve();
    fake.emit(emptyFinalEvent());
    await waitFor(() => discarded.settled, 'discard to settle');

    assert.equal(discarded.error, undefined);
    assert.equal(fake.calls.deletedFolders, 1);
    assert.equal(fake.calls.deletedBatches, 0);
    assert.deepEqual(fake.records.names, ['ready', 'createRecordingSession', 'markCancelled']);
  });

  describe('(11) a live polish chunk still running is aborted and awaited before stop settles', () => {
    it('when polish was turned off before stop', async () => {
      fetchStub = stubFetch(
        () => jsonResponse(200, { text: LONG_TEXT }),
        () => new Promise(() => {}), // only the abort ends it
      );
      const fake = createFakeHost();
      fake.polish.enabled = true;
      const run = await startDictation(testConfig, fake.host);
      fake.emit(framesEvent(scoredFrames(LIVE_BATCH_PATTERN)));
      await waitFor(() => fetchStub.inferenceRequests.length === 1, 'the live chunk');

      fake.polish.enabled = false;
      const outcome = await stopWith(fake, run, emptyFinalEvent());
      assert.deepEqual(outcome, { kind: 'transcript', text: LONG_TEXT });
      assert.equal(fetchStub.inferenceRequests[0].init.signal.aborted, true);
      assert.equal(fetchStub.inferenceRequests.length, 1);
    });

    it('when transcription failed', async () => {
      let uploads = 0;
      fetchStub = stubFetch(
        () => {
          uploads += 1;
          return uploads === 1
            ? jsonResponse(200, { text: LONG_TEXT })
            : jsonResponse(400, { error: { message: 'bad audio' } });
        },
        () => new Promise(() => {}),
      );
      const fake = createFakeHost();
      fake.polish.enabled = true;
      const run = await startDictation(testConfig, fake.host);
      fake.emit(framesEvent(scoredFrames(LIVE_BATCH_PATTERN)));
      await waitFor(() => fetchStub.inferenceRequests.length === 1, 'the live chunk');

      const outcome = await stopWith(fake, run, finalSpeechEvent());
      assert.equal(outcome.kind, 'failed');
      assert.equal(fetchStub.inferenceRequests[0].init.signal.aborted, true);
      assert.equal(fake.records.outputs.length, 0);
    });
  });

  it('(12) the saved duration is the last frame end in milliseconds', async () => {
    fetchStub = stubFetch(() => jsonResponse(200, { text: 'Hello.' }));
    const fake = createFakeHost();
    const run = await startDictation(testConfig, fake.host);
    const live = framesEvent(scoredFrames(LIVE_BATCH_PATTERN));
    fake.emit(live);
    await stopWith(fake, run, emptyFinalEvent()); // a final event with no frames adds nothing

    const [recorded] = fake.records.argumentsOf('markRecorded');
    assert.equal(recorded.durationMs, Math.round(live.endSamples.at(-1) / 16));
    assert.ok(
      recorded.durationMs > 12_000 && recorded.durationMs <= 13_000,
      String(recorded.durationMs),
    );
  });

  describe('(13) onPolishing', () => {
    it('is called once, before the polish request, when polish is on', async () => {
      fetchStub = stubFetch(() => jsonResponse(200, { text: 'hello' }));
      const fake = createFakeHost();
      fake.polish.enabled = true;
      const requestsWhenCalled = [];
      const run = await startDictation(testConfig, fake.host);
      await stopWith(fake, run, finalSpeechEvent(), {
        onPolishing: () => requestsWhenCalled.push(fetchStub.inferenceRequests.length),
      });
      assert.deepEqual(requestsWhenCalled, [0]);
      assert.equal(fetchStub.inferenceRequests.length, 1);
    });

    it('is not called when polish is off, on no speech, or on a failed batch', async () => {
      const onPolishing = mock.fn();
      fetchStub = stubFetch(() => jsonResponse(200, { text: 'hello' }));
      const off = createFakeHost();
      await stopWith(off, await startDictation(testConfig, off.host), finalSpeechEvent(), {
        onPolishing,
      });

      const silent = createFakeHost();
      silent.polish.enabled = true;
      await stopWith(silent, await startDictation(testConfig, silent.host), emptyFinalEvent(), {
        onPolishing,
      });
      fetchStub.restore();

      fetchStub = stubFetch(() => jsonResponse(400, { error: { message: 'bad audio' } }));
      const failing = createFakeHost();
      failing.polish.enabled = true;
      const outcome = await stopWith(
        failing,
        await startDictation(testConfig, failing.host),
        finalSpeechEvent(),
        { onPolishing },
      );
      assert.equal(outcome.kind, 'failed');
      assert.equal(onPolishing.mock.callCount(), 0);
    });

    it('a throwing onPolishing does not change the outcome', async () => {
      fetchStub = stubFetch(() => jsonResponse(200, { text: 'hello' }));
      const fake = createFakeHost();
      fake.polish.enabled = true;
      const run = await startDictation(testConfig, fake.host);
      const outcome = await stopWith(fake, run, finalSpeechEvent(), {
        onPolishing: () => {
          throw new Error('render failed');
        },
      });
      assert.deepEqual(outcome, { kind: 'transcript', text: 'Polished text.' });
    });
  });

  it('oneDictationAtATime passes the stop options through', async () => {
    fetchStub = stubFetch(() => jsonResponse(200, { text: 'hello' }));
    const fake = createFakeHost();
    fake.polish.enabled = true;
    const run = await oneDictationAtATime((config) => startDictation(config, fake.host))(
      testConfig,
    );
    const onPolishing = mock.fn();
    await stopWith(fake, run, finalSpeechEvent(), { onPolishing });
    assert.equal(onPolishing.mock.callCount(), 1);
  });
});
