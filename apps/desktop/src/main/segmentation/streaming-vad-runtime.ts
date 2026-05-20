import type { VadRuntimeStatus } from '@toph/desktop-contracts';

import { createEnergyStreamingSpeechActivityAnalyzer } from './analyzers/energy-streaming-speech-activity-analyzer';
import {
  createSileroStreamingVadBackend,
  SileroStreamingVadBusyError,
} from './analyzers/silero-streaming-speech-activity-analyzer';
import type { StreamingSpeechActivityAnalyzerSession } from './streaming/types';

export class StreamingVadBusyError extends Error {
  constructor() {
    super('Another dictation operation is already using voice detection.');
    this.name = 'StreamingVadBusyError';
  }
}

export interface StreamingVadRuntime {
  name: string;
  sampleRate: number;
  frameSizeSamples: number;
  prepare: () => Promise<void>;
  createSession: () => Promise<StreamingSpeechActivityAnalyzerSession>;
  dispose: () => Promise<void>;
  getStatus: () => VadRuntimeStatus;
}

interface StreamingVadBackend {
  name: string;
  sampleRate: number;
  frameSizeSamples: number;
  prepare: () => Promise<void>;
  createSession: () => Promise<StreamingSpeechActivityAnalyzerSession>;
  dispose: () => Promise<void>;
}

class RuntimeFallbackSession implements StreamingSpeechActivityAnalyzerSession {
  private active: StreamingSpeechActivityAnalyzerSession;
  private activeName: string;
  private readonly options: {
    primaryName: string;
    fallback: StreamingVadBackend;
    primary: StreamingSpeechActivityAnalyzerSession;
    degrade: (detail: string) => void;
  };

  constructor(options: {
    primaryName: string;
    fallback: StreamingVadBackend;
    primary: StreamingSpeechActivityAnalyzerSession;
    degrade: (detail: string) => void;
  }) {
    this.options = options;
    this.active = options.primary;
    this.activeName = options.primaryName;
  }

  async scoreFrame(frame: Float32Array) {
    try {
      return await this.active.scoreFrame(frame);
    } catch (error) {
      if (this.activeName === this.options.fallback.name) {
        throw error;
      }

      console.error(
        `Toph streaming VAD analyzer ${this.activeName} failed while processing; falling back to ${this.options.fallback.name}.`,
        error,
      );
      try {
        await this.active.dispose();
      } catch (disposeError) {
        console.error(
          `Toph could not dispose failed VAD analyzer ${this.activeName}.`,
          disposeError,
        );
      }

      this.options.degrade(
        'Silero VAD failed while processing audio. Falling back to basic energy detection.',
      );
      this.active = await this.options.fallback.createSession();
      this.activeName = this.options.fallback.name;
      return this.active.scoreFrame(frame);
    }
  }

  async flush() {
    await this.active.flush();
  }

  async dispose() {
    await this.active.dispose();
  }
}

class RuntimeLeasedSession implements StreamingSpeechActivityAnalyzerSession {
  private disposed = false;
  private readonly session: StreamingSpeechActivityAnalyzerSession;
  private readonly release: () => void;

  constructor(session: StreamingSpeechActivityAnalyzerSession, release: () => void) {
    this.session = session;
    this.release = release;
  }

  async scoreFrame(frame: Float32Array) {
    return this.session.scoreFrame(frame);
  }

  async flush() {
    await this.session.flush();
  }

  async dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    try {
      await this.session.dispose();
    } finally {
      this.release();
    }
  }
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function isBusyError(error: unknown) {
  return error instanceof StreamingVadBusyError || error instanceof SileroStreamingVadBusyError;
}

export function createDefaultStreamingVadRuntime(
  options: {
    onStatusChanged?: (status: VadRuntimeStatus) => void;
  } = {},
): StreamingVadRuntime {
  const primary = createSileroStreamingVadBackend();
  const energyAnalyzer = createEnergyStreamingSpeechActivityAnalyzer({
    frameSizeSamples: primary.frameSizeSamples,
  });
  const fallback: StreamingVadBackend = {
    ...energyAnalyzer,
    async prepare() {},
    async dispose() {},
  };
  let status: VadRuntimeStatus = {
    kind: 'ready',
    activeAnalyzer: 'silero',
    detail: 'Voice activity detection is ready.',
  };
  let activeSession = false;

  const setStatus = (nextStatus: VadRuntimeStatus) => {
    status = nextStatus;
    options.onStatusChanged?.(status);
  };

  const degrade = (detail: string) => {
    setStatus({ kind: 'degraded', activeAnalyzer: 'energy', detail });
  };

  return {
    name: `${primary.name}-with-${fallback.name}-fallback`,
    sampleRate: primary.sampleRate,
    frameSizeSamples: primary.frameSizeSamples,

    async prepare() {
      try {
        await primary.prepare();
        setStatus({
          kind: 'ready',
          activeAnalyzer: 'silero',
          detail: 'Voice activity detection is ready.',
        });
      } catch (error) {
        const detail = `Silero VAD failed to load. Falling back to basic energy detection. ${describeError(error)}.`;
        console.error('Toph Silero VAD failed to prepare; falling back to energy VAD.', error);
        await fallback.prepare();
        degrade(detail);
      }
    },

    async createSession() {
      if (activeSession) {
        console.error('Toph streaming VAD rejected a second active session.');
        throw new StreamingVadBusyError();
      }

      activeSession = true;
      const release = () => {
        activeSession = false;
      };

      if (status.kind === 'degraded') {
        try {
          console.info(`Toph streaming VAD using ${fallback.name} because Silero is degraded.`);
          return new RuntimeLeasedSession(await fallback.createSession(), release);
        } catch (error) {
          release();
          throw error;
        }
      }

      try {
        const primarySession = await primary.createSession();
        return new RuntimeLeasedSession(
          new RuntimeFallbackSession({
            primaryName: primary.name,
            fallback,
            primary: primarySession,
            degrade,
          }),
          release,
        );
      } catch (error) {
        if (isBusyError(error)) {
          release();
          throw new StreamingVadBusyError();
        }

        const detail = `Silero VAD failed to start. Falling back to basic energy detection. ${describeError(error)}.`;
        console.error(
          `Toph could not initialize ${primary.name}; falling back to ${fallback.name}.`,
          error,
        );
        degrade(detail);
        try {
          return new RuntimeLeasedSession(await fallback.createSession(), release);
        } catch (fallbackError) {
          release();
          throw fallbackError;
        }
      }
    },

    async dispose() {
      await primary.dispose();
      await fallback.dispose();
      console.info('Toph streaming VAD runtime disposed.');
    },

    getStatus() {
      return status;
    },
  };
}

export { isBusyError as isStreamingVadBusyError };
