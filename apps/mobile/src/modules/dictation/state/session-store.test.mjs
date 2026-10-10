/**
 * The session store's run ownership, with a fake `startDictation` and fake runs whose promises the
 * test resolves by hand:
 * - Stop or Discard during a pending start is applied once the start settles;
 * - a new start is refused until the held run's teardown has settled;
 * - the phase moves from transcribing to polishing when the run reports it, while the run is held.
 *   (The engine saves runs to history; its tests cover that.)
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { createSessionStore } from './session-store.ts';

const config = { model: 'gpt-4o-transcribe' };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** Lets every promise callback that is already queued run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** A run whose `stop` and `discard` settle only when the test says so. */
function fakeRun() {
  const stopped = deferred();
  const discarded = deferred();
  return {
    stopped,
    discarded,
    run: {
      stop: mock.fn(() => stopped.promise),
      discard: mock.fn(() => discarded.promise),
    },
  };
}

/** A store whose `startDictation` returns the next pending start the test controls. */
function harness({ connected = true } = {}) {
  const starts = [];
  const deps = {
    readProviderConfig: mock.fn(() => (connected ? config : null)),
    startDictation: mock.fn(() => {
      const start = deferred();
      starts.push(start);
      return start.promise;
    }),
  };
  const store = createSessionStore(deps);
  return { store, deps, starts, state: () => store.getState() };
}

/** Starts a run and lets its start resolve, so the store holds a started run. */
async function startedRun(h) {
  const fake = fakeRun();
  h.state().start();
  h.starts.at(-1).resolve(fake.run);
  await settle();
  return fake;
}

afterEach(() => {
  mock.restoreAll();
});

describe('session store', () => {
  it('starts listening and calls startDictation with the provider config', () => {
    const h = harness();
    h.state().start();
    assert.equal(h.state().phase, 'listening');
    assert.notEqual(h.state().startedAt, null);
    assert.equal(h.state().outcome, null);
    assert.deepEqual(h.deps.startDictation.mock.calls[0].arguments, [config]);
  });

  it('applies a stop made during a pending start once the start resolves', async () => {
    const h = harness();
    h.state().start();
    h.state().stop();
    assert.equal(h.state().phase, 'transcribing');

    const fake = fakeRun();
    h.starts[0].resolve(fake.run);
    await settle();
    assert.equal(fake.run.stop.mock.callCount(), 1);
    assert.equal(fake.run.discard.mock.callCount(), 0);
    assert.equal(h.state().phase, 'transcribing');

    fake.stopped.resolve({ kind: 'transcript', text: 'hello there' });
    await settle();
    assert.equal(h.state().phase, 'done');
    assert.deepEqual(h.state().outcome, { kind: 'transcript', text: 'hello there' });
    assert.equal(h.state().startedAt, null);
  });

  it('ends in idle, not failed, when the start rejects after a discard', async () => {
    const h = harness();
    h.state().start();
    h.state().cancel();
    assert.equal(h.state().phase, 'listening');

    h.starts[0].reject(new Error('Microphone is busy.'));
    await settle();
    assert.equal(h.state().phase, 'idle');
    assert.equal(h.state().outcome, null);
  });

  it('discards the run when the start resolves after a discard', async () => {
    const h = harness();
    h.state().start();
    h.state().cancel();

    const fake = fakeRun();
    h.starts[0].resolve(fake.run);
    await settle();
    assert.equal(fake.run.discard.mock.callCount(), 1);
    assert.equal(fake.run.stop.mock.callCount(), 0);
    assert.equal(h.state().phase, 'listening', 'the phase holds until the teardown settles');

    fake.discarded.resolve();
    await settle();
    assert.equal(h.state().phase, 'idle');
    assert.equal(h.state().outcome, null);
  });

  it('ignores taps while a discard is tearing down', async () => {
    const h = harness();
    const fake = await startedRun(h);
    h.state().cancel();
    await settle();
    h.state().stop();
    h.state().start();
    h.state().cancel();
    assert.equal(h.state().phase, 'listening');
    assert.equal(fake.run.discard.mock.callCount(), 1);
    assert.equal(fake.run.stop.mock.callCount(), 0);
    assert.equal(h.deps.startDictation.mock.callCount(), 1);
  });

  it('refuses a new start until the held run has settled', async () => {
    const h = harness();
    const fake = await startedRun(h);
    h.state().stop();
    await settle();

    h.state().start();
    assert.equal(h.deps.startDictation.mock.callCount(), 1);
    assert.equal(h.state().phase, 'transcribing');

    fake.stopped.resolve({ kind: 'no_speech' });
    await settle();
    assert.equal(h.state().phase, 'done');

    h.state().start();
    assert.equal(h.deps.startDictation.mock.callCount(), 2);
    assert.equal(h.state().phase, 'listening');
    assert.equal(h.state().outcome, null);
  });

  it('fails with the reason when the start rejects', async () => {
    const h = harness();
    h.state().start();
    h.starts[0].reject(new Error('Silero failed to load.'));
    await settle();
    assert.equal(h.state().phase, 'failed');
    assert.deepEqual(h.state().outcome, {
      kind: 'failed',
      message: "Couldn't start recording: Silero failed to load.",
    });

    h.state().start();
    assert.equal(h.deps.startDictation.mock.callCount(), 2, 'a failure accepts a new start');
  });

  it('fails without starting when no provider is connected', async () => {
    const h = harness({ connected: false });
    h.state().start();
    await settle();
    assert.equal(h.deps.startDictation.mock.callCount(), 0);
    assert.equal(h.state().phase, 'failed');
    assert.deepEqual(h.state().outcome, { kind: 'failed', message: 'Connect a provider first.' });
  });

  it('a run that fails ends in failed with its message', async () => {
    const h = harness();
    const fake = await startedRun(h);
    h.state().stop();
    fake.stopped.resolve({ kind: 'failed', message: 'OpenAI transcription failed: HTTP 401' });
    await settle();
    assert.equal(h.state().phase, 'failed');
    assert.deepEqual(h.state().outcome, {
      kind: 'failed',
      message: 'OpenAI transcription failed: HTTP 401',
    });
  });

  it('shows polishing once the run reports it, until the run settles', async () => {
    const h = harness();
    const fake = await startedRun(h);
    h.state().stop();
    await settle();
    assert.equal(h.state().phase, 'transcribing');

    const [options] = fake.run.stop.mock.calls[0].arguments;
    options.onPolishing();
    assert.equal(h.state().phase, 'polishing');
    h.state().start();
    assert.equal(h.deps.startDictation.mock.callCount(), 1, 'polishing still holds the run');

    fake.stopped.resolve({ kind: 'transcript', text: 'Ship it.' });
    await settle();
    assert.equal(h.state().phase, 'done');
    assert.deepEqual(h.state().outcome, { kind: 'transcript', text: 'Ship it.' });
  });

  it('ends in failed after polishing when polish fails', async () => {
    const h = harness();
    const fake = await startedRun(h);
    h.state().stop();
    await settle();
    fake.run.stop.mock.calls[0].arguments[0].onPolishing();
    fake.stopped.resolve({ kind: 'failed', message: 'Polish failed unexpectedly.' });
    await settle();
    assert.equal(h.state().phase, 'failed');
  });
});
