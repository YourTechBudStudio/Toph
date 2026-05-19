import { closeSync, openSync, writeSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BrowserWindow, ipcMain } from 'electron';

import type {
  CaptureChunkMessage,
  CaptureErrorMessage,
  CaptureLifecycleMessage,
} from '@toph/desktop-contracts';
import { DESKTOP_CAPTURE_IPC_CHANNELS } from '@toph/desktop-contracts';

export interface RawAudioRecordingResult {
  outputPath: string;
  durationMs: number;
  bytesWritten: number;
}

export interface RawAudioRecorder {
  start: (options: {
    sessionId: string;
    outputPath: string;
    inputDeviceId: string | null;
    onPcmChunk?: (chunk: Buffer) => Promise<void> | void;
    onInputDeviceFallback?: () => void;
  }) => Promise<void>;
  stop: () => Promise<RawAudioRecordingResult>;
  dispose: () => void;
}

const sampleRate = 16_000;
const channelCount = 1;
const bitsPerSample = 16;
const captureStartupTimeoutMs = 5_000;
const captureStopTimeoutMs = 5_000;
const mainBundleDir = dirname(fileURLToPath(import.meta.url));
const capturePreloadPath = join(mainBundleDir, '../preload/capture.mjs');

function getCaptureRendererPath() {
  if (process.env.ELECTRON_RENDERER_URL) {
    return `${process.env.ELECTRON_RENDERER_URL}/capture.html`;
  }

  return join(mainBundleDir, '../renderer/capture.html');
}

async function loadCaptureRenderer(window: BrowserWindow) {
  const rendererPath = getCaptureRendererPath();
  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(rendererPath);
    return;
  }

  await window.loadFile(rendererPath);
}

function writeWavHeader(fd: number, dataBytes: number) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channelCount * (bitsPerSample / 8);
  const blockAlign = channelCount * (bitsPerSample / 8);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channelCount, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);

  writeSync(fd, header, 0, header.length, 0);
}

class WavFileWriter {
  private fd: number;
  private dataBytes = 0;

  constructor(private readonly outputPath: string) {
    this.fd = openSync(outputPath, 'w');
    writeWavHeader(this.fd, 0);
  }

  write(chunk: ArrayBuffer | Buffer) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    writeSync(this.fd, buffer, 0, buffer.length, 44 + this.dataBytes);
    this.dataBytes += buffer.length;
  }

  finalize() {
    writeWavHeader(this.fd, this.dataBytes);
    closeSync(this.fd);
    return {
      outputPath: this.outputPath,
      bytesWritten: this.dataBytes + 44,
      durationMs: Math.round((this.dataBytes / (sampleRate * channelCount * 2)) * 1000),
    };
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

export function createElectronCaptureAudioRecorder(): RawAudioRecorder {
  let captureWindow: BrowserWindow | null = null;
  let activeSessionId: string | null = null;
  let activeOutputPath: string | null = null;
  let wavWriter: WavFileWriter | null = null;
  let activeChunkHandler: ((chunk: Buffer) => Promise<void> | void) | null = null;
  let activeInputDeviceFallbackHandler: (() => void) | null = null;
  let startDeferred: ReturnType<typeof createDeferred<void>> | null = null;
  let stopDeferred: ReturnType<typeof createDeferred<void>> | null = null;
  let captureError: Error | null = null;

  const destroyCaptureWindow = () => {
    if (captureWindow && !captureWindow.isDestroyed()) {
      captureWindow.destroy();
    }

    captureWindow = null;
  };

  const ensureCaptureWindow = async () => {
    if (captureWindow && !captureWindow.isDestroyed()) {
      return captureWindow;
    }

    captureWindow = new BrowserWindow({
      width: 1,
      height: 1,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        preload: capturePreloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    captureWindow.on('closed', () => {
      captureWindow = null;
      if (activeSessionId) {
        captureError = new Error('Capture renderer closed while recording.');
      }
    });

    await loadCaptureRenderer(captureWindow);
    return captureWindow;
  };

  const handleStarted = (_event: Electron.IpcMainEvent, message: CaptureLifecycleMessage) => {
    if (_event.sender !== captureWindow?.webContents) {
      return;
    }

    if (message.sessionId !== activeSessionId) {
      return;
    }

    startDeferred?.resolve();
    startDeferred = null;
    if (message.inputDeviceFallbackUsed) {
      activeInputDeviceFallbackHandler?.();
    }
  };

  const handleStopped = (_event: Electron.IpcMainEvent, message: CaptureLifecycleMessage) => {
    if (_event.sender !== captureWindow?.webContents) {
      return;
    }

    if (message.sessionId !== activeSessionId) {
      return;
    }

    stopDeferred?.resolve();
    stopDeferred = null;
  };

  const handleChunk = (_event: Electron.IpcMainEvent, message: CaptureChunkMessage) => {
    if (_event.sender !== captureWindow?.webContents) {
      return;
    }

    if (message.sessionId !== activeSessionId || !wavWriter) {
      return;
    }

    try {
      const chunk = Buffer.from(message.chunk);
      wavWriter.write(chunk);
      void Promise.resolve(activeChunkHandler?.(Buffer.from(chunk))).catch((error: unknown) => {
        console.error('Toph live audio chunk observer failed.', error);
      });
    } catch (error) {
      captureError =
        error instanceof Error ? error : new Error('Audio chunk could not be written.');
      startDeferred?.reject(captureError);
      stopDeferred?.reject(captureError);
      startDeferred = null;
      stopDeferred = null;
      destroyCaptureWindow();
    }
  };

  const handleError = (_event: Electron.IpcMainEvent, message: CaptureErrorMessage) => {
    if (_event.sender !== captureWindow?.webContents) {
      return;
    }

    if (message.sessionId && message.sessionId !== activeSessionId) {
      return;
    }

    captureError = new Error(message.message);
    startDeferred?.reject(captureError);
    stopDeferred?.reject(captureError);
    startDeferred = null;
    stopDeferred = null;
  };

  ipcMain.on(DESKTOP_CAPTURE_IPC_CHANNELS.started, handleStarted);
  ipcMain.on(DESKTOP_CAPTURE_IPC_CHANNELS.stopped, handleStopped);
  ipcMain.on(DESKTOP_CAPTURE_IPC_CHANNELS.chunk, handleChunk);
  ipcMain.on(DESKTOP_CAPTURE_IPC_CHANNELS.error, handleError);

  return {
    async start({ sessionId, outputPath, inputDeviceId, onPcmChunk, onInputDeviceFallback }) {
      if (activeSessionId) {
        throw new Error('Audio recording is already active.');
      }

      await mkdir(dirname(outputPath), { recursive: true });

      try {
        const window = await ensureCaptureWindow();
        activeSessionId = sessionId;
        activeOutputPath = outputPath;
        activeChunkHandler = onPcmChunk ?? null;
        activeInputDeviceFallbackHandler = onInputDeviceFallback ?? null;
        captureError = null;
        wavWriter = new WavFileWriter(outputPath);
        startDeferred = createDeferred<void>();

        window.webContents.send(DESKTOP_CAPTURE_IPC_CHANNELS.start, {
          sessionId,
          sampleRate,
          inputDeviceId,
        });

        await withTimeout(
          startDeferred.promise,
          captureStartupTimeoutMs,
          'Microphone capture did not start in time.',
        );
      } catch (error) {
        try {
          captureWindow?.webContents.send(DESKTOP_CAPTURE_IPC_CHANNELS.stop);
        } catch {
          // The capture renderer may already be gone; the original error is more useful.
        }

        wavWriter?.finalize();
        destroyCaptureWindow();
        wavWriter = null;
        activeSessionId = null;
        activeOutputPath = null;
        activeChunkHandler = null;
        activeInputDeviceFallbackHandler = null;
        startDeferred = null;
        throw error;
      }
    },

    async stop() {
      if (!activeSessionId || !activeOutputPath || !wavWriter) {
        throw new Error('Audio recording is not active.');
      }

      stopDeferred = createDeferred<void>();
      captureWindow?.webContents.send(DESKTOP_CAPTURE_IPC_CHANNELS.stop);

      try {
        await withTimeout(
          stopDeferred.promise,
          captureStopTimeoutMs,
          'Microphone capture did not stop in time.',
        );
      } catch (error) {
        const failedWriter = wavWriter;
        activeSessionId = null;
        activeOutputPath = null;
        activeChunkHandler = null;
        activeInputDeviceFallbackHandler = null;
        wavWriter = null;
        stopDeferred = null;
        failedWriter?.finalize();
        destroyCaptureWindow();
        throw error;
      }

      if (captureError) {
        const error = captureError;
        wavWriter.finalize();
        activeSessionId = null;
        activeOutputPath = null;
        activeChunkHandler = null;
        activeInputDeviceFallbackHandler = null;
        wavWriter = null;
        stopDeferred = null;
        captureError = null;
        throw error;
      }

      const result = wavWriter.finalize();

      activeSessionId = null;
      activeOutputPath = null;
      activeChunkHandler = null;
      activeInputDeviceFallbackHandler = null;
      wavWriter = null;
      stopDeferred = null;
      captureError = null;

      if (result.bytesWritten <= 44) {
        throw new Error('Recording finished without audio data.');
      }

      return result;
    },

    dispose() {
      ipcMain.removeListener(DESKTOP_CAPTURE_IPC_CHANNELS.started, handleStarted);
      ipcMain.removeListener(DESKTOP_CAPTURE_IPC_CHANNELS.stopped, handleStopped);
      ipcMain.removeListener(DESKTOP_CAPTURE_IPC_CHANNELS.chunk, handleChunk);
      ipcMain.removeListener(DESKTOP_CAPTURE_IPC_CHANNELS.error, handleError);

      wavWriter?.finalize();
      wavWriter = null;
      activeSessionId = null;
      activeOutputPath = null;
      activeChunkHandler = null;
      activeInputDeviceFallbackHandler = null;
      destroyCaptureWindow();
    },
  };
}
