/**
 * Shared fakes for the engine tests: Silero frame events, a hand-driven native host, and a fetch
 * stub. Not a test file itself.
 */

const FRAME_SAMPLES = 512;
const SAMPLE_RATE = 16_000;

/**
 * Consecutive 512-sample frames from sample 0, as native capture reports them, for a pattern such
 * as `[{ ms: 2_000, p: 0.9 }, { ms: 1_000, p: 0.05 }]`.
 */
export function scoredFrames(pattern) {
  const frames = [];
  let sample = 0;
  for (const { ms, p } of pattern) {
    const end = sample + Math.round((ms / 1000) * SAMPLE_RATE);
    while (sample + FRAME_SAMPLES <= end) {
      frames.push({ start: sample, end: sample + FRAME_SAMPLES, probability: p });
      sample += FRAME_SAMPLES;
    }
  }
  return frames;
}

/** One `onFrames` event carrying `frames`. */
export function framesEvent(frames, { final = false, error = null } = {}) {
  return {
    startSamples: frames.map((frame) => frame.start),
    endSamples: frames.map((frame) => frame.end),
    probabilities: frames.map((frame) => frame.probability),
    final,
    error,
  };
}

/** 11 s of speech then a 2 s pause: enough for the planner to cut a live batch at the pause. */
export const LIVE_BATCH_PATTERN = [
  { ms: 11_000, p: 0.9 },
  { ms: 2_000, p: 0.05 },
];

/** 2 s of speech: planned only when the recording stops. */
export const SHORT_SPEECH_PATTERN = [
  { ms: 2_000, p: 0.9 },
  { ms: 300, p: 0.05 },
];

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/** Lets pending promise chains and timers that are already due run. */
export async function settle(rounds = 20) {
  for (let round = 0; round < rounds; round += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Waits until `condition()` holds, failing after a bounded number of turns. */
export async function waitFor(condition, description) {
  for (let round = 0; round < 500; round += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

/** Tracks whether a promise has settled, without awaiting it. */
export function track(promise) {
  const state = { settled: false, value: undefined, error: undefined };
  promise.then(
    (value) => {
      state.settled = true;
      state.value = value;
    },
    (error) => {
      state.settled = true;
      state.error = error;
    },
  );
  return state;
}

/**
 * A `DictationHost` whose native calls the test resolves by hand. Each `startCapture`,
 * `stopCapture` and `cutBatch` call returns a fresh deferred recorded in `calls`, unless the test
 * set `autoResolve` for it.
 */
export function createFakeHost() {
  const listeners = new Set();
  const calls = { startCapture: [], stopCapture: [], cutBatch: [], deletedFolders: 0 };
  const autoResolve = { startCapture: true, stopCapture: false, cutBatch: true };

  const call = (name, args) => {
    const pending = deferred();
    calls[name].push({ args, ...pending });
    if (autoResolve[name]) {
      pending.resolve();
    }
    return pending.promise;
  };

  const host = {
    voice: {
      addListener(eventName, listener) {
        if (eventName !== 'onFrames') {
          throw new Error(`Unexpected event ${eventName}.`);
        }
        listeners.add(listener);
        return { remove: () => listeners.delete(listener) };
      },
      startCapture: (rawWavUri) => call('startCapture', [rawWavUri]),
      stopCapture: () => call('stopCapture', []),
      cutBatch: (rawWavUri, ranges, outUri) => call('cutBatch', [rawWavUri, ranges, outUri]),
    },
    createSessionFolder: (sessionId) => ({
      rawWavUri: `file:///cache/dictation/${sessionId}/raw.wav`,
      batchUri: (sequence) =>
        `file:///cache/dictation/${sessionId}/batches/batch-${String(sequence + 1).padStart(4, '0')}.wav`,
      readBytes: async () => new Uint8Array([1, 2, 3, 4]),
      delete: () => {
        calls.deletedFolders += 1;
      },
    }),
  };

  return {
    host,
    calls,
    autoResolve,
    get listenerCount() {
      return listeners.size;
    },
    /** Delivers an event to every current listener, as the native module would. */
    emit(event) {
      for (const listener of [...listeners]) {
        listener(event);
      }
    },
  };
}

export const testConfig = {
  transcriptionModel: 'gpt-4o-transcribe',
  credentials: async () => ({
    formValues: { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test' },
  }),
};

/** The batch id the client sent, read from the multipart file name (`<batchId>.wav`). */
export function batchIdOf(request) {
  const body = new TextDecoder().decode(request.init.body);
  return /filename="([^"]+)\.wav"/u.exec(body)?.[1] ?? null;
}

export function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Replaces `globalThis.fetch` for one test and records each request. A request whose handler is
 * still pending rejects when its signal aborts, as a real fetch does.
 */
export function stubFetch(handler) {
  const requests = [];
  const original = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => {
    const request = { url: String(input), init };
    requests.push(request);
    return new Promise((resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      Promise.resolve(handler(request)).then(resolve, reject);
    });
  };
  return {
    requests,
    restore() {
      globalThis.fetch = original;
    },
  };
}
