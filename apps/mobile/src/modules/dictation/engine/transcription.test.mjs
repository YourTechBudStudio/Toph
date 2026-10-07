/**
 * One dictation's uploads go through the core coordinator and OpenAI client, and their results
 * become one outcome: texts joined in batch order, "no speech", or the first failed batch's message.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  batchIdOf,
  deferred,
  jsonResponse,
  stubFetch,
  testConfig,
  track,
  waitFor,
} from './test-support.mjs';
import { createTranscription } from './transcription.ts';

const SESSION = 'session_test';

function plannedBatch(sequence) {
  return {
    id: `batch_${sequence}`,
    sessionId: SESSION,
    sequence,
    sourceDurationMs: 2_000,
    derivedAudioDurationMs: 2_000,
    createdLive: true,
    sourceRanges: [],
  };
}

function newTranscription(lines = []) {
  return createTranscription({
    sessionId: SESSION,
    config: testConfig,
    readBatchAudio: async () => new Uint8Array([1, 2, 3, 4]),
    log: (line) => lines.push(line),
  });
}

let fetchStub = null;
afterEach(() => {
  fetchStub?.restore();
  fetchStub = null;
});

describe('createTranscription', () => {
  it('finishes with no speech when nothing was planned', async () => {
    fetchStub = stubFetch(() => {
      throw new Error('no request expected');
    });
    assert.deepEqual(await newTranscription().finish(), { kind: 'no_speech' });
    assert.equal(fetchStub.requests.length, 0);
  });

  it('joins texts by batch sequence, not by the order responses arrive', async () => {
    const responses = new Map([
      ['batch_0', deferred()],
      ['batch_1', deferred()],
    ]);
    fetchStub = stubFetch((request) => responses.get(batchIdOf(request)).promise);
    const lines = [];
    const transcription = newTranscription(lines);

    await transcription.addBatch(plannedBatch(0), 'file:///batch-0001.wav');
    await transcription.addBatch(plannedBatch(1), 'file:///batch-0002.wav');
    await waitFor(() => fetchStub.requests.length === 2, 'both uploads');
    responses.get('batch_1').resolve(jsonResponse(200, { text: 'world.' }));
    responses.get('batch_0').resolve(jsonResponse(200, { text: ' Hello ' }));

    assert.deepEqual(await transcription.finish(), { kind: 'transcript', text: 'Hello world.' });
    assert.ok(lines.includes('batch 1 upload attempt 1 started'));
    assert.ok(lines.some((line) => /^batch 2 upload attempt 1 succeeded in \d+ms$/u.test(line)));
  });

  it('finishes with no speech when every batch comes back empty', async () => {
    fetchStub = stubFetch(() => jsonResponse(200, { text: '' }));
    const transcription = newTranscription();
    await transcription.addBatch(plannedBatch(0), 'file:///batch-0001.wav');
    await transcription.addBatch(plannedBatch(1), 'file:///batch-0002.wav');
    assert.deepEqual(await transcription.finish(), { kind: 'no_speech' });
  });

  it('fails with the failed batch message when one batch is rejected', async () => {
    fetchStub = stubFetch((request) =>
      batchIdOf(request) === 'batch_1'
        ? jsonResponse(400, { error: { message: 'Invalid file format.' } })
        : jsonResponse(200, { text: 'Hello.' }),
    );
    const lines = [];
    const transcription = newTranscription(lines);
    await transcription.addBatch(plannedBatch(0), 'file:///batch-0001.wav');
    await transcription.addBatch(plannedBatch(1), 'file:///batch-0002.wav');

    const outcome = await transcription.finish();
    assert.equal(outcome.kind, 'failed');
    assert.match(
      outcome.message,
      /^OpenAI transcription failed: HTTP 400 .*Invalid file format\./u,
    );
    // A 400 is permanent: one attempt, no retry.
    assert.equal(fetchStub.requests.length, 2);
    assert.ok(lines.includes('batch 2 failed after 1 attempts'));
  });

  it('cancel aborts an in-flight upload and settles without an outcome', async () => {
    fetchStub = stubFetch(() => new Promise(() => {})); // only the abort ends it
    const transcription = newTranscription();
    await transcription.addBatch(plannedBatch(0), 'file:///batch-0001.wav');
    await waitFor(() => fetchStub.requests.length === 1, 'the upload');

    const cancelled = track(transcription.cancel());
    await waitFor(() => cancelled.settled, 'cancel to settle');
    assert.equal(cancelled.error, undefined);
    assert.equal(cancelled.value, undefined);
    assert.equal(fetchStub.requests[0].init.signal.aborted, true);
  });
});
