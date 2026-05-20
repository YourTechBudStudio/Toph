import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import type {
  StreamingSpeechActivityAnalyzer,
  StreamingSpeechActivityAnalyzerSession,
} from './streaming-speech-activity-analyzer';

interface SileroSpeechProbabilities {
  isSpeech: number;
  notSpeech: number;
}

interface SileroModel {
  process: (frame: Float32Array) => Promise<SileroSpeechProbabilities>;
  reset_state: () => void;
  release: () => Promise<void>;
}

interface SileroModelConstructor {
  new: (ortInstance: unknown, modelFetcher: () => Promise<ArrayBuffer>) => Promise<SileroModel>;
}

export interface SileroStreamingVadBackend {
  name: string;
  sampleRate: number;
  frameSizeSamples: number;
  prepare: () => Promise<void>;
  createSession: () => Promise<StreamingSpeechActivityAnalyzerSession>;
  dispose: () => Promise<void>;
}

export class SileroStreamingVadBusyError extends Error {
  constructor() {
    super('Another dictation operation is already using voice detection.');
    this.name = 'SileroStreamingVadBusyError';
  }
}

export interface SileroStreamingSpeechActivityPolicy {
  model: 'v5';
}

const defaultPolicy: SileroStreamingSpeechActivityPolicy = {
  model: 'v5',
};

const require = createRequire(import.meta.url);
const v5FrameSizeSamples = 512;

async function fetchModelFromFile(path: string) {
  const model = await readFile(path);
  return model.buffer.slice(model.byteOffset, model.byteOffset + model.byteLength);
}

function resolveV5ModelPath() {
  const vadPackagePath = require.resolve('@ricky0123/vad-web/package.json');
  const vadPackageDirectory = dirname(vadPackagePath);
  return join(vadPackageDirectory, 'dist', 'silero_vad_v5.onnx');
}

function createVadRequire() {
  return createRequire(require.resolve('@ricky0123/vad-web/package.json'));
}

function loadSileroV5() {
  const vadRequire = createVadRequire();
  return vadRequire('@ricky0123/vad-web/dist/models') as { SileroV5: SileroModelConstructor };
}

function loadOrt() {
  const vadRequire = createVadRequire();
  return vadRequire('onnxruntime-web/wasm') as unknown;
}

class SileroStreamingSpeechActivitySession implements StreamingSpeechActivityAnalyzerSession {
  private readonly model: SileroModel;

  constructor(model: SileroModel) {
    this.model = model;
  }

  async scoreFrame(frame: Float32Array) {
    const probability = await this.model.process(frame);
    return probability.isSpeech;
  }

  async flush() {
    this.model.reset_state();
  }

  async dispose() {
    await this.model.release();
  }
}

class ReusableSileroStreamingSpeechActivitySession implements StreamingSpeechActivityAnalyzerSession {
  private disposed = false;
  private readonly options: {
    model: SileroModel;
    release: () => void;
  };

  constructor(options: { model: SileroModel; release: () => void }) {
    this.options = options;
    options.model.reset_state();
  }

  async scoreFrame(frame: Float32Array) {
    const probability = await this.options.model.process(frame);
    return probability.isSpeech;
  }

  async flush() {
    this.options.model.reset_state();
  }

  async dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.options.model.reset_state();
    this.options.release();
  }
}

export function createSileroStreamingVadBackend(
  policy: Partial<SileroStreamingSpeechActivityPolicy> = {},
): SileroStreamingVadBackend {
  const resolvedPolicy = { ...defaultPolicy, ...policy };
  let model: SileroModel | null = null;
  let preparePromise: Promise<void> | null = null;
  let active = false;
  let disposed = false;

  const loadModel = async () => {
    if (resolvedPolicy.model !== 'v5') {
      throw new Error(`Unsupported Silero model ${resolvedPolicy.model}.`);
    }

    const { SileroV5 } = loadSileroV5();
    return SileroV5.new(loadOrt(), () => fetchModelFromFile(resolveV5ModelPath()));
  };

  const prepare = () => {
    if (disposed) {
      throw new Error('Silero streaming VAD backend has been disposed.');
    }
    if (model) {
      return Promise.resolve();
    }

    preparePromise ??= (async () => {
      const startedAt = Date.now();
      console.info('Toph streaming VAD preparing Silero model.');
      model = await loadModel();
      console.info(`Toph streaming VAD prepared Silero model in ${Date.now() - startedAt}ms.`);
    })().catch((error: unknown) => {
      preparePromise = null;
      throw error;
    });

    return preparePromise;
  };

  return {
    name: 'silero-streaming-v5',
    sampleRate: 16_000,
    frameSizeSamples: v5FrameSizeSamples,

    prepare,

    async createSession() {
      await prepare();
      if (!model) {
        throw new Error('Silero streaming VAD model is unavailable.');
      }
      if (active) {
        console.error('Toph streaming VAD rejected a second active Silero session.');
        throw new SileroStreamingVadBusyError();
      }

      active = true;
      console.info('Toph streaming VAD acquired Silero session.');
      return new ReusableSileroStreamingSpeechActivitySession({
        model,
        release: () => {
          active = false;
          console.info('Toph streaming VAD released Silero session.');
        },
      });
    },

    async dispose() {
      disposed = true;
      if (active) {
        console.warn('Toph streaming VAD is disposing while a Silero session is active.');
      }

      const modelToRelease = model;
      model = null;
      preparePromise = null;
      active = false;

      if (!modelToRelease) {
        return;
      }

      try {
        await modelToRelease.release();
        console.info('Toph streaming VAD released Silero model.');
      } catch (error) {
        console.error('Toph streaming VAD could not release Silero model.', error);
      }
    },
  };
}

export function createSileroStreamingSpeechActivityAnalyzer(
  policy: Partial<SileroStreamingSpeechActivityPolicy> = {},
): StreamingSpeechActivityAnalyzer {
  const resolvedPolicy = { ...defaultPolicy, ...policy };

  const loadModel = async () => {
    if (resolvedPolicy.model !== 'v5') {
      throw new Error(`Unsupported Silero model ${resolvedPolicy.model}.`);
    }

    const { SileroV5 } = loadSileroV5();
    return SileroV5.new(loadOrt(), () => fetchModelFromFile(resolveV5ModelPath()));
  };

  return {
    name: 'silero-streaming-v5',
    sampleRate: 16_000,
    frameSizeSamples: v5FrameSizeSamples,

    async createSession() {
      return new SileroStreamingSpeechActivitySession(await loadModel());
    },
  };
}
