import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerHooks } from 'node:module';
import test from 'node:test';

import type { PasteAttempt } from '@toph/desktop-contracts';

import type { RecordingSession, TranscriptionBatch } from '../src/main/db/schema.ts';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') && !specifier.match(/\.[cm]?[jt]sx?$/)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

const { createDictationController } = await import('../src/main/dictation.ts');
const { createDesktopStateStore } = await import('../src/main/state.ts');
const { defaultAppSettings } = await import('../src/main/settings/app-settings-schema.ts');

async function createRawAudioPath() {
  const directory = await mkdtemp(join(tmpdir(), 'toph-dictation-rerun-'));
  const path = join(directory, 'recording.wav');
  await writeFile(path, 'audio');
  return path;
}

async function createSession(overrides: Partial<RecordingSession> = {}): Promise<RecordingSession> {
  const now = Date.now();
  return {
    id: 'session-1',
    createdAt: now,
    startedAt: now,
    endedAt: now,
    durationMs: 1_000,
    rawAudioPath: await createRawAudioPath(),
    transcriptionProviderId: 'openai-sub',
    transcriptionModel: 'chatgpt-backend-transcribe',
    status: 'failed',
    selectedOutputId: null,
    errorMessage: '1 transcription batch failed or did not finish.',
    ...overrides,
  };
}

function createTranscribedBatch(overrides: Partial<TranscriptionBatch> = {}): TranscriptionBatch {
  return {
    id: 'batch-1',
    sessionId: 'session-1',
    sequence: 0,
    status: 'transcribed',
    sourceDurationMs: 1_000,
    derivedAudioDurationMs: 1_000,
    createdLive: false,
    derivedAudioPath: '/tmp/batch.wav',
    createdAt: Date.now(),
    transcriptionAttempts: 1,
    transcriptionStartedAt: Date.now(),
    transcribedAt: Date.now(),
    errorMessage: null,
    ...overrides,
  };
}

function createPasteAttempt(overrides: Partial<PasteAttempt> = {}): PasteAttempt {
  return {
    helper: 'test-helper',
    status: 'success',
    detail: 'Transcript copied to the clipboard and paste was attempted with test-helper.',
    copiedToClipboard: true,
    ...overrides,
  };
}

async function createRerunHarness(options: {
  phase: 'idle' | 'failed';
  pasteAttempt: PasteAttempt;
}) {
  const stateStore = createDesktopStateStore({ appVersion: '0.0.0-test' });
  const session = await createSession({
    status: options.phase === 'failed' ? 'failed' : 'completed',
    selectedOutputId: options.phase === 'failed' ? null : 'existing-output',
    errorMessage: options.phase === 'failed' ? '1 transcription batch failed or did not finish.' : null,
  });
  const selectedOutputs: Array<{ sessionId: string; outputId: string }> = [];
  const copiedTexts: string[] = [];
  const emittedSounds: string[] = [];
  let recentRefreshes = 0;
  let pasteSupportRefreshes = 0;

  if (options.phase === 'failed') {
    stateStore.failDictation('1 transcription batch failed or did not finish.', {
      sessionId: session.id,
      canRetry: true,
    });
  }

  const controller = createDictationController({
    stateStore,
    sessionStore: {
      createRecordingSession: async () => {
        throw new Error('createRecordingSession should not be called.');
      },
      getSession: async () => session,
      markRecorded: async () => {},
      markSegmented: async () => {},
      markPolishing: async () => {},
      markNoSpeech: async () => {},
      markFailed: async () => {},
      markRecordingFailed: async () => {},
      markCancelled: async () => {},
      setProcessingError: async () => {},
      clearSegmentationData: async () => {},
      discardSessionArtifacts: async () => {},
      prepareSessionForRerun: async () => {
        throw new Error('prepareSessionForRerun should not be called.');
      },
      pruneRetainedSessions: async () => {},
      listTranscriptionBatchesForSession: async () => [createTranscribedBatch()],
    },
    segmentation: {
      createLiveSession: async () => {
        throw new Error('createLiveSession should not be called.');
      },
      segmentRecordedSession: async () => {
        throw new Error('segmentRecordedSession should not be called.');
      },
    },
    transcription: {
      onBatchReady: async () => {},
      waitForSession: async () => ({ failedOrIncompleteBatchCount: 0 }),
      cancelSession: async () => {},
      dispose: async () => {},
    },
    outputs: {
      createRawConcatOutput: async (_sessionId, createOptions) => ({
        id: createOptions?.outputId ?? 'raw-output',
        text: 'Recovered transcript.',
        createdAt: 123,
      }),
      createPolishedOutput: async () => {
        throw new Error('createPolishedOutput should not be called.');
      },
      selectOutput: async (input) => {
        selectedOutputs.push(input);
      },
    },
    polish: {
      polishOutput: async () => {
        throw new Error('polishOutput should not be called.');
      },
    },
    settingsStore: {
      getSettings: () => ({
        ...defaultAppSettings,
        polish: { ...defaultAppSettings.polish, enabled: false },
      }),
    },
    audioRecorder: {
      start: async () => {},
      stop: async () => ({ outputPath: session.rawAudioPath, durationMs: 0, bytesWritten: 0 }),
      dispose: () => {},
    },
    clipboard: {
      describePasteSupport: async () => ({ helper: 'test-helper', detail: 'ready' }),
      copyAndPasteText: async (text) => {
        copiedTexts.push(text);
        return options.pasteAttempt;
      },
    },
    ensurePermissionsReady: async () => true,
    windows: {
      showOverlay: () => {},
      emitSound: (kind) => {
        emittedSounds.push(kind);
      },
    },
    onPasteSupportMayHaveChanged: async () => {
      pasteSupportRefreshes += 1;
    },
    onDashboardStatsChanged: async () => {},
    onRecentSessionsChanged: async () => {
      recentRefreshes += 1;
    },
  });

  return {
    controller,
    stateStore,
    selectedOutputs,
    copiedTexts,
    emittedSounds,
    get recentRefreshes() {
      return recentRefreshes;
    },
    get pasteSupportRefreshes() {
      return pasteSupportRefreshes;
    },
  };
}

test('active failed-session retry copies, pastes, and completes like normal dictation on paste success', async () => {
  const harness = await createRerunHarness({
    phase: 'failed',
    pasteAttempt: createPasteAttempt(),
  });

  await harness.controller.rerunSession('session-1');

  assert.deepEqual(harness.copiedTexts, ['Recovered transcript.']);
  assert.deepEqual(harness.selectedOutputs, [{ sessionId: 'session-1', outputId: 'raw-output' }]);
  assert.equal(harness.stateStore.getState().phase, 'idle');
  assert.equal(harness.stateStore.getState().activeFailure, null);
  assert.equal(harness.stateStore.getState().lastTranscript, 'Recovered transcript.');
  assert.equal(harness.stateStore.getState().lastPasteAttempt.status, 'success');
  assert.equal(harness.pasteSupportRefreshes, 1);
  assert.deepEqual(harness.emittedSounds, ['done']);
});

test('active failed-session retry shows copied fallback when paste fails after clipboard copy', async () => {
  const harness = await createRerunHarness({
    phase: 'failed',
    pasteAttempt: createPasteAttempt({
      status: 'failed',
      detail: 'Transcript copied to the clipboard. test-helper was found, but paste failed.',
      copiedToClipboard: true,
    }),
  });

  await harness.controller.rerunSession('session-1');

  assert.deepEqual(harness.copiedTexts, ['Recovered transcript.']);
  assert.equal(harness.stateStore.getState().phase, 'copied');
  assert.equal(harness.stateStore.getState().lastPasteAttempt.status, 'clipboard-only');
  assert.equal(harness.stateStore.getState().lastPasteAttempt.detail, 'Transcription copied.');
  assert.equal(harness.stateStore.getState().recentSessions[0]?.pasteStatus, 'clipboard-only');
  assert.equal(harness.pasteSupportRefreshes, 1);
});

test('active failed-session retry completes consistently when clipboard write fails', async () => {
  const harness = await createRerunHarness({
    phase: 'failed',
    pasteAttempt: createPasteAttempt({
      helper: null,
      status: 'failed',
      detail: 'Transcript could not be copied to the clipboard.',
      copiedToClipboard: false,
    }),
  });

  await harness.controller.rerunSession('session-1');

  assert.deepEqual(harness.copiedTexts, ['Recovered transcript.']);
  assert.deepEqual(harness.selectedOutputs, [{ sessionId: 'session-1', outputId: 'raw-output' }]);
  assert.equal(harness.stateStore.getState().phase, 'idle');
  assert.equal(harness.stateStore.getState().activeFailure, null);
  assert.equal(harness.stateStore.getState().lastPasteAttempt.status, 'failed');
  assert.equal(harness.stateStore.getState().recentSessions[0]?.status, 'completed');
  assert.equal(harness.stateStore.getState().recentSessions[0]?.pasteStatus, 'failed');
});

test('history rerun remains delivery-neutral while idle', async () => {
  const harness = await createRerunHarness({
    phase: 'idle',
    pasteAttempt: createPasteAttempt(),
  });

  await harness.controller.rerunSession('session-1');

  assert.deepEqual(harness.copiedTexts, []);
  assert.deepEqual(harness.selectedOutputs, [{ sessionId: 'session-1', outputId: 'existing-output' }]);
  assert.equal(harness.stateStore.getState().phase, 'idle');
  assert.equal(harness.stateStore.getState().lastTranscript, null);
  assert.equal(harness.pasteSupportRefreshes, 0);
});
