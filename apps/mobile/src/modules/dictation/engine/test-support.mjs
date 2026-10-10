/**
 * Shared fakes for the engine tests: Silero frame events, a hand-driven native host with fake
 * history records and polish sources, and a fetch stub. Not a test file itself.
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
 * History's writes, in memory. `calls` lists every call as `[method, argument]` in order;
 * `failOn.add(method)` makes that method reject with "<method> failed." from then on.
 */
export function createFakeRecords() {
  const calls = [];
  const failOn = new Set();
  const outputs = [];
  const method =
    (name, effect = () => {}) =>
    async (argument) => {
      calls.push([name, argument]);
      if (failOn.has(name)) {
        throw new Error(`${name} failed.`);
      }
      effect(argument);
    };
  const records = {
    ready: method('ready'),
    createRecordingSession: method('createRecordingSession'),
    markRecorded: method('markRecorded'),
    markNoSpeech: method('markNoSpeech'),
    markFailed: method('markFailed'),
    markCancelled: method('markCancelled'),
    createSessionOutput: method('createSessionOutput', ({ output }) => outputs.push(output)),
    selectSessionOutput: method('selectSessionOutput'),
    pruneAndRefresh: method('pruneAndRefresh'),
  };
  return {
    records,
    calls,
    failOn,
    outputs,
    /** The method names called, in order. */
    get names() {
      return calls.map(([name]) => name);
    },
    /** The argument of each call to `name`. */
    argumentsOf(name) {
      return calls.filter(([called]) => called === name).map(([, argument]) => argument);
    },
  };
}

export const testPreset = {
  id: 'preset-test',
  title: 'Test',
  description: 'For tests.',
  body: 'Fix the punctuation.',
  bodyHash: 'hash-test',
  isBuiltin: false,
  sortOrder: 0,
  createdAt: 0,
  updatedAt: 0,
};

/** Polish sources with one preset and an empty dictionary. Polish is off unless the test turns it on. */
export function createFakePolish() {
  const settings = { enabled: false, rulePresetId: testPreset.id };
  const sources = {
    ready: async () => {},
    getSettings: () => ({ polish: { ...settings } }),
    getPolishRulePreset: async (id) => (id === testPreset.id ? testPreset : null),
    listDictionaryEntries: async () => [],
  };
  return { sources, settings };
}

/**
 * A `DictationHost` whose native calls the test resolves by hand. Each `startCapture`,
 * `stopCapture` and `cutBatch` call returns a fresh deferred recorded in `calls`, unless the test
 * set `autoResolve` for it. `records` and `polish` are the fakes above.
 */
export function createFakeHost() {
  const listeners = new Set();
  const calls = {
    startCapture: [],
    stopCapture: [],
    cutBatch: [],
    createdFolders: 0,
    deletedFolders: 0,
    deletedBatches: 0,
  };
  const records = createFakeRecords();
  const polish = createFakePolish();
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
    createSessionFolder: (sessionId) => {
      calls.createdFolders += 1;
      return {
        rawWavUri: `file:///documents/recordings/${sessionId}/raw.wav`,
        relativeRawAudioPath: `recordings/${sessionId}/raw.wav`,
        batchUri: (sequence) =>
          `file:///documents/recordings/${sessionId}/batches/batch-${String(sequence + 1).padStart(4, '0')}.wav`,
        readBytes: async () => new Uint8Array([1, 2, 3, 4]),
        deleteBatches: () => {
          calls.deletedBatches += 1;
        },
        delete: () => {
          calls.deletedFolders += 1;
        },
      };
    },
    records: records.records,
    polish: polish.sources,
  };

  return {
    host,
    calls,
    autoResolve,
    records,
    polish: polish.settings,
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
  inference: () => ({ model: 'gpt-test', reasoningEffort: '', api: 'chat' }),
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

/** A Chat Completions response body whose message is `text`. */
export function chatCompletion(text) {
  return {
    id: 'chatcmpl-test',
    choices: [{ index: 0, message: { role: 'assistant', content: text } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
}

const isInference = (url) => url.endsWith('/chat/completions');

/**
 * Replaces `globalThis.fetch` for one test and records each request. Transcription requests go to
 * `handler` and are recorded in `requests`; polish requests (`/chat/completions`) go to `inference`,
 * which answers "Polished text." unless the test passes its own, and are recorded in
 * `inferenceRequests`. A request whose handler is still pending rejects when its signal aborts, as
 * a real fetch does.
 */
export function stubFetch(
  handler,
  inference = () => jsonResponse(200, chatCompletion('Polished text.')),
) {
  const requests = [];
  const inferenceRequests = [];
  const original = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => {
    const request = { url: String(input), init };
    const polish = isInference(request.url);
    (polish ? inferenceRequests : requests).push(request);
    return new Promise((resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      Promise.resolve((polish ? inference : handler)(request)).then(resolve, reject);
    });
  };
  return {
    requests,
    inferenceRequests,
    restore() {
      globalThis.fetch = original;
    },
  };
}
