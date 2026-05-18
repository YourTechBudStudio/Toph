import type { ScreenshotContextImage } from '@toph/desktop-contracts';

import {
  createDictationPromptCaptureSession,
  readDictationPromptText,
  resolveDictationAudioPath,
  writeDictationPromptText,
  type DictationPromptCaptureSession,
} from './context/dictation-prompt-context';
import type {
  ScreenshotContextService,
  ScreenshotContextSession,
} from './context/screenshot-context-service';
import type { RawAudioRecorder } from './managers/audio-recorder';
import type { ClipboardManager } from './managers/clipboard';
import type { WindowManager } from './managers/windows';
import type { SessionOutputService } from './outputs/session-output-service';
import type { PolishService } from './polish/polish-service';
import type { SessionSegmentationService } from './segmentation/session-segmentation-service';
import { isStreamingVadBusyError } from './segmentation/streaming-vad-runtime';
import type { SegmentationPipelineSession } from './segmentation/streaming/segmentation-pipeline-session';
import type { AppSettingsStore } from './settings/app-settings-store';
import type { DesktopStateStore } from './state';
import type { RecordingSessionStore } from './stores/session-store';
import type { SessionTranscriptionCoordinator } from './transcription/session-transcription-coordinator';

export interface DictationController {
  toggleCapture: () => Promise<void>;
  cancelCapture: () => Promise<void>;
  captureScreenshotContext: () => Promise<void>;
  toggleDictationPromptCapture: () => Promise<void>;
  rerunSession: (sessionId: string) => Promise<void>;
  dispose: () => Promise<void>;
}

const toggleDebounceMs = 800;
const failureVisibleMs = 2_000;
const noSpeechVisibleMs = 2_000;
const maxLiveProcessingBacklog = 100;
type DictationLifecycle = 'idle' | 'starting' | 'listening' | 'stopping' | 'cancelling';

function describeUnexpectedError(prefix: string, error: unknown) {
  const detail = error instanceof Error ? error.message : 'Unknown error';
  return `${prefix} ${detail}.`;
}

function describeBusyVadError() {
  return 'Another dictation operation is already using voice detection. Please wait for it to finish.';
}

export function createDictationController(options: {
  stateStore: DesktopStateStore;
  sessionStore: Pick<
    RecordingSessionStore,
    | 'createRecordingSession'
    | 'markRecorded'
    | 'markSegmented'
    | 'markPolishing'
    | 'markNoSpeech'
    | 'markFailed'
    | 'markRecordingFailed'
    | 'markCancelled'
    | 'setProcessingError'
    | 'clearSegmentationData'
    | 'discardSessionArtifacts'
    | 'prepareSessionForRerun'
    | 'pruneRetainedSessions'
    | 'listTranscriptionBatchesForSession'
  >;
  segmentation: SessionSegmentationService;
  transcription: SessionTranscriptionCoordinator;
  outputs: SessionOutputService;
  polish: PolishService;
  settingsStore: Pick<AppSettingsStore, 'getSettings'>;
  screenshotContext: ScreenshotContextService;
  audioRecorder: RawAudioRecorder;
  clipboard: ClipboardManager;
  ensurePermissionsReady: () => Promise<boolean>;
  windows: Pick<WindowManager, 'showOverlay' | 'emitSound'>;
  onDashboardStatsChanged: () => Promise<void>;
  onRecentSessionsChanged: () => Promise<void>;
}): DictationController {
  let failureTimer: ReturnType<typeof setTimeout> | null = null;
  let noSpeechTimer: ReturnType<typeof setTimeout> | null = null;
  let lastToggleRequestAt = 0;
  let activeSession: {
    id: string;
    rawAudioPath: string;
    preserveArtifactsOnCancel?: boolean;
    rerunOutputId?: string | null;
  } | null = null;
  let activeLivePipeline: SegmentationPipelineSession | null = null;
  let liveProcessingErrorMessage: string | null = null;
  let liveProcessingQueue: Promise<void> = Promise.resolve();
  let liveProcessingBacklog = 0;
  let liveProcessingGeneration = 0;
  let activeOperationGeneration = 0;
  let activeRecorderStop: Promise<Awaited<ReturnType<RawAudioRecorder['stop']>>> | null = null;
  let activeFinishTask: Promise<void> | null = null;
  let activeScreenshotContext: ScreenshotContextSession | null = null;
  let activeDictationPromptContext: DictationPromptCaptureSession | null = null;
  let lifecycle: DictationLifecycle = 'idle';
  let activePolishAbortController: AbortController | null = null;

  const clearFailureTimer = () => {
    if (!failureTimer) {
      return;
    }

    clearTimeout(failureTimer);
    failureTimer = null;
  };

  const clearNoSpeechTimer = () => {
    if (!noSpeechTimer) {
      return;
    }

    clearTimeout(noSpeechTimer);
    noSpeechTimer = null;
  };

  const returnToIdleAfterFailure = () => {
    clearFailureTimer();
    failureTimer = setTimeout(() => {
      failureTimer = null;
      options.stateStore.setPhase('idle');
    }, failureVisibleMs);
  };

  const returnToIdleAfterNoSpeech = () => {
    clearNoSpeechTimer();
    noSpeechTimer = setTimeout(() => {
      noSpeechTimer = null;
      options.stateStore.setPhase('idle');
    }, noSpeechVisibleMs);
  };

  const startScreenshotContext = (session: { rawAudioPath: string }) => {
    const screenshotContext = options.screenshotContext.createSession({
      settings: options.settingsStore.getSettings(),
      rawAudioPath: session.rawAudioPath,
      onStateChanged: options.stateStore.setScreenshotContext,
    });
    activeScreenshotContext = screenshotContext;
    screenshotContext.start();
  };

  const getDictationPromptState = (optionsOverride?: {
    status?: 'ready' | 'capturing' | 'captured' | 'ignored' | 'error';
    detail?: string;
    capturedDurationMs?: number;
  }) => {
    const settings = options.settingsStore.getSettings();
    if (!settings.context.dictationPrompt.enabled) {
      return {
        enabled: false,
        status: 'disabled' as const,
        detail: 'Dictation Prompt is off.',
        capturedDurationMs: 0,
      };
    }

    if (!settings.polish.enabled) {
      return {
        enabled: true,
        status: 'ignored' as const,
        detail: 'Dictation Prompt needs Polish to be enabled.',
        capturedDurationMs: 0,
      };
    }

    return {
      enabled: true,
      status: optionsOverride?.status ?? ('ready' as const),
      detail:
        optionsOverride?.detail ??
        'Ready. Toggle Dictation Prompt while listening to add polish instructions.',
      capturedDurationMs: optionsOverride?.capturedDurationMs ?? 0,
    };
  };

  const resetDictationPromptState = () => {
    options.stateStore.setDictationPrompt(getDictationPromptState());
  };

  const canUseDictationPrompt = () => {
    const settings = options.settingsStore.getSettings();
    return settings.context.dictationPrompt.enabled && settings.polish.enabled;
  };

  const startDictationPromptContext = (session: { rawAudioPath: string }) => {
    if (!canUseDictationPrompt()) {
      activeDictationPromptContext = null;
      resetDictationPromptState();
      return null;
    }

    const context = createDictationPromptCaptureSession(session.rawAudioPath);
    activeDictationPromptContext = context;
    options.stateStore.setDictationPrompt(getDictationPromptState());
    return context;
  };

  const disposeActiveScreenshotContext = async () => {
    const screenshotContext = activeScreenshotContext;
    activeScreenshotContext = null;
    try {
      await screenshotContext?.dispose();
    } catch (error) {
      console.error('Toph could not dispose screenshot context capture.', error);
    }
  };

  const stopActiveScreenshotContext = async () => {
    const screenshotContext = activeScreenshotContext;
    activeScreenshotContext = null;
    if (!screenshotContext) {
      return [];
    }

    try {
      return await screenshotContext.stop();
    } catch (error) {
      console.error('Toph could not stop screenshot context capture.', error);
      return screenshotContext.listImages();
    }
  };

  const transcribeDictationPrompt = async (input: {
    sessionId: string;
    rawAudioPath: string;
    promptAudioPath: string | null;
    promptDurationMs: number;
    signal?: AbortSignal;
  }) => {
    if (!canUseDictationPrompt() || !input.promptAudioPath || input.promptDurationMs <= 0) {
      return null;
    }

    try {
      const result = await options.transcription.transcribeAudio({
        sessionId: input.sessionId,
        audioPath: input.promptAudioPath,
        durationMs: input.promptDurationMs,
        label: 'dictation-prompt',
        signal: input.signal,
      });
      const text = await writeDictationPromptText(input.rawAudioPath, result.text);
      options.stateStore.setDictationPrompt(
        getDictationPromptState({
          status: text ? 'captured' : 'ignored',
          detail: text
            ? 'Dictation Prompt captured for this polish pass.'
            : 'Dictation Prompt did not contain usable instructions.',
          capturedDurationMs: input.promptDurationMs,
        }),
      );
      return text;
    } catch (error) {
      console.error('Toph could not transcribe Dictation Prompt context.', error);
      options.stateStore.setDictationPrompt(
        getDictationPromptState({
          status: 'error',
          detail: 'Dictation Prompt could not be transcribed. Continuing without it.',
          capturedDurationMs: input.promptDurationMs,
        }),
      );
      return null;
    }
  };

  const readStoredDictationPromptText = async (rawAudioPath: string) => {
    try {
      return await readDictationPromptText(rawAudioPath);
    } catch (error) {
      console.error('Toph could not read retained Dictation Prompt context.', error);
      return null;
    }
  };

  const failProcessedSession = async (error: unknown) => {
    const session = activeSession;
    const pipeline = activeLivePipeline;
    const dictationPromptContext = activeDictationPromptContext;
    if (session) {
      try {
        await options.sessionStore.markFailed({
          sessionId: session.id,
          errorMessage: describeUnexpectedError(
            'Live segmentation could not finish unexpectedly.',
            error,
          ),
        });
        await options.transcription.cancelSession(session.id);
        await options.sessionStore.clearSegmentationData(session.id);
      } catch (markError) {
        console.error('Toph could not persist the live segmentation failure.', markError);
      }
    }

    activeSession = null;
    activeLivePipeline = null;
    activeDictationPromptContext = null;
    await disposeActiveScreenshotContext();
    dictationPromptContext?.dispose();
    resetDictationPromptState();
    liveProcessingErrorMessage = null;
    liveProcessingQueue = Promise.resolve();
    liveProcessingBacklog = 0;
    liveProcessingGeneration += 1;
    lifecycle = 'idle';
    await pipeline?.dispose();
    console.error('Toph could not complete live segmentation for the recording session.', error);
    options.stateStore.failDictation('Unable to transcribe.');
    options.windows.showOverlay();
    await pruneSessions();
    await refreshRecentSessionsBestEffort();
    returnToIdleAfterFailure();
  };

  const failActiveSession = async (detail: string, error: unknown) => {
    const message = isStreamingVadBusyError(error)
      ? detail
      : describeUnexpectedError(detail, error);
    const failedSession = activeSession;
    const failedPipeline = activeLivePipeline;
    const failedScreenshotContext = activeScreenshotContext;
    const failedDictationPromptContext = activeDictationPromptContext;
    const pendingLiveProcessing = liveProcessingQueue;
    activeSession = null;
    activeLivePipeline = null;
    activeScreenshotContext = null;
    activeDictationPromptContext = null;
    liveProcessingErrorMessage = null;
    liveProcessingQueue = Promise.resolve();
    liveProcessingBacklog = 0;
    liveProcessingGeneration += 1;
    lifecycle = 'idle';

    await pendingLiveProcessing.catch((queueError: unknown) => {
      console.error('Toph live segmentation queue failed while recording was failing.', queueError);
    });
    await failedPipeline?.dispose();
    await failedScreenshotContext?.dispose().catch((screenshotError: unknown) => {
      console.error(
        'Toph screenshot context capture failed while recording was failing.',
        screenshotError,
      );
    });
    failedDictationPromptContext?.dispose();
    resetDictationPromptState();

    if (failedSession) {
      try {
        await options.sessionStore.markRecordingFailed({
          sessionId: failedSession.id,
          errorMessage: message,
        });
        await options.transcription.cancelSession(failedSession.id);
        await options.sessionStore.clearSegmentationData(failedSession.id);
      } catch (markError) {
        console.error('Toph could not mark the recording session as failed.', markError);
      }
    }

    console.error(message, error);
    options.stateStore.failDictation(message);
    options.windows.showOverlay();
    await pruneSessions();
    await refreshRecentSessionsBestEffort();
    returnToIdleAfterFailure();
  };

  const completeNoSpeechRecording = async () => {
    options.stateStore.noSpeechDetected();
    options.windows.showOverlay();
    options.windows.emitSound('done');
    await refreshRecentSessionsBestEffort();
    returnToIdleAfterNoSpeech();
  };

  const rerunRecordedWorkflow = async (requestedSessionId: string) => {
    const { phase, ruleSwitcher } = options.stateStore.getState();
    if (lifecycle !== 'idle' || phase !== 'idle' || ruleSwitcher.mode !== 'idle') {
      return;
    }
    if (!(await options.ensurePermissionsReady())) {
      return;
    }

    clearFailureTimer();
    clearNoSpeechTimer();
    activeOperationGeneration += 1;
    const operationGeneration = activeOperationGeneration;
    lifecycle = 'stopping';
    options.stateStore.startTranscribing();
    options.windows.showOverlay();

    let sessionId: string | null = null;
    let existingOutputId: string | null = null;

    try {
      const prepared = await options.sessionStore.prepareSessionForRerun(requestedSessionId);
      sessionId = prepared.session.id;
      existingOutputId = prepared.outputId;
      activeSession = {
        id: prepared.session.id,
        rawAudioPath: prepared.session.rawAudioPath,
        preserveArtifactsOnCancel: true,
        rerunOutputId: existingOutputId,
      };
      if (!isCurrentOperation(operationGeneration)) {
        activeSession = null;
        lifecycle = 'idle';
        if (existingOutputId) {
          await options.outputs.selectOutput({ sessionId, outputId: existingOutputId });
        }
        return;
      }

      const segmentationOutcome = await options.segmentation.segmentRecordedSession({
        sessionId,
        generateBatchAudio: true,
        audioPath: await resolveDictationAudioPath(prepared.session.rawAudioPath),
        preserveSelectedOutput: true,
      });
      if (!isCurrentOperation(operationGeneration)) {
        activeSession = null;
        lifecycle = 'idle';
        await options.sessionStore.clearSegmentationData(sessionId, {
          preserveSelectedOutput: true,
        });
        if (existingOutputId) {
          await options.outputs.selectOutput({ sessionId, outputId: existingOutputId });
        }
        return;
      }

      const polishSettings = options.settingsStore.getSettings().polish;
      const dictationPromptText = polishSettings.enabled
        ? await readStoredDictationPromptText(prepared.session.rawAudioPath)
        : null;

      if (segmentationOutcome === 'no_speech' && !dictationPromptText) {
        if (existingOutputId) {
          await options.outputs.selectOutput({ sessionId, outputId: existingOutputId });
        } else {
          await options.sessionStore.markNoSpeech(sessionId);
        }
        activeSession = null;
        lifecycle = 'idle';
        await completeNoSpeechRecording();
        return;
      }

      const batches = await options.sessionStore.listTranscriptionBatchesForSession(sessionId);
      await Promise.all(batches.map((batch) => options.transcription.onBatchReady(batch.id)));
      const transcriptionOutcome = await options.transcription.waitForSession(sessionId);
      if (!isCurrentOperation(operationGeneration)) {
        activeSession = null;
        lifecycle = 'idle';
        await options.sessionStore.clearSegmentationData(sessionId, {
          preserveSelectedOutput: true,
        });
        if (existingOutputId) {
          await options.outputs.selectOutput({ sessionId, outputId: existingOutputId });
        }
        return;
      }

      if (transcriptionOutcome.failedOrIncompleteBatchCount > 0) {
        throw new Error(
          `${transcriptionOutcome.failedOrIncompleteBatchCount} transcription batch${transcriptionOutcome.failedOrIncompleteBatchCount === 1 ? '' : 'es'} failed or did not finish.`,
        );
      }

      if (!polishSettings.enabled) {
        if (!isCurrentOperation(operationGeneration)) {
          return;
        }

        const rawOutput = await options.outputs.createRawConcatOutput(
          sessionId,
          existingOutputId ? { outputId: existingOutputId } : undefined,
        );
        if (!isCurrentOperation(operationGeneration)) {
          activeSession = null;
          lifecycle = 'idle';
          if (existingOutputId) {
            await options.outputs.selectOutput({ sessionId, outputId: existingOutputId });
          }
          return;
        }

        await options.outputs.selectOutput({ sessionId, outputId: rawOutput.id });
        activeSession = null;
        lifecycle = 'idle';
        options.stateStore.setPhase('idle');
        options.windows.emitSound('done');
        void refreshRecentSessionsBestEffort();
        return;
      }

      const rawOutput = await options.outputs.createRawConcatOutput(sessionId, {
        allowEmpty: segmentationOutcome === 'no_speech' && !!dictationPromptText,
      });
      if (!isCurrentOperation(operationGeneration)) {
        activeSession = null;
        lifecycle = 'idle';
        if (existingOutputId) {
          await options.outputs.selectOutput({ sessionId, outputId: existingOutputId });
        }
        return;
      }

      await options.sessionStore.markPolishing(sessionId);
      options.stateStore.startPolishing();
      if (!isCurrentOperation(operationGeneration)) {
        activeSession = null;
        lifecycle = 'idle';
        if (existingOutputId) {
          await options.outputs.selectOutput({ sessionId, outputId: existingOutputId });
        }
        return;
      }

      activePolishAbortController = new AbortController();
      const screenshotContext = await options.screenshotContext.listImagesForSession(
        options.settingsStore.getSettings(),
        prepared.session.rawAudioPath,
      );
      const polishedOutput = await options.polish.polishOutput({
        sessionId,
        rawOutput,
        screenshotContext,
        dictationPromptText,
        signal: activePolishAbortController.signal,
        outputId: existingOutputId ?? undefined,
      });
      activePolishAbortController = null;
      if (!isCurrentOperation(operationGeneration)) {
        activeSession = null;
        lifecycle = 'idle';
        if (existingOutputId) {
          await options.outputs.selectOutput({ sessionId, outputId: existingOutputId });
        }
        return;
      }

      await options.outputs.selectOutput({ sessionId, outputId: polishedOutput.id });
      activeSession = null;
      lifecycle = 'idle';
      options.stateStore.setPhase('idle');
      options.windows.emitSound('done');
      void refreshRecentSessionsBestEffort();
    } catch (error) {
      activePolishAbortController = null;
      if (!isCurrentOperation(operationGeneration)) {
        return;
      }
      activeSession = null;
      lifecycle = 'idle';
      const errorMessage = isStreamingVadBusyError(error)
        ? describeBusyVadError()
        : describeUnexpectedError('Rerun failed unexpectedly.', error);
      if (sessionId) {
        await options.transcription.cancelSession(sessionId);
        await options.sessionStore.clearSegmentationData(sessionId, {
          preserveSelectedOutput: true,
        });
        if (existingOutputId) {
          await options.outputs.selectOutput({ sessionId, outputId: existingOutputId });
        } else {
          await options.sessionStore.markFailed({ sessionId, errorMessage });
        }
      }
      options.stateStore.failDictation(errorMessage);
      options.windows.showOverlay();
      returnToIdleAfterFailure();
      void refreshRecentSessionsBestEffort();
      throw error;
    }
  };

  const isCurrentOperation = (generation: number) => generation === activeOperationGeneration;

  const stopActiveRecorder = () => {
    activeRecorderStop ??= options.audioRecorder.stop().finally(() => {
      activeRecorderStop = null;
    });
    return activeRecorderStop;
  };

  const runFinishListening = () => {
    activeFinishTask ??= finishListening().finally(() => {
      activeFinishTask = null;
    });
    return activeFinishTask;
  };

  const pruneSessions = async () => {
    try {
      await options.sessionStore.pruneRetainedSessions();
      await refreshDashboardStatsBestEffort();
    } catch (error) {
      console.error('Toph could not prune old recording sessions.', error);
    }
  };

  const refreshDashboardStatsBestEffort = async () => {
    try {
      await options.onDashboardStatsChanged();
    } catch (error) {
      console.error('Toph could not refresh dashboard stats.', error);
    }
  };

  const refreshRecentSessionsBestEffort = async () => {
    try {
      await options.onRecentSessionsChanged();
    } catch (error) {
      console.error('Toph could not refresh recent sessions.', error);
    }
  };

  const beginListening = async () => {
    clearFailureTimer();
    clearNoSpeechTimer();
    liveProcessingErrorMessage = null;
    activeOperationGeneration += 1;
    const operationGeneration = activeOperationGeneration;

    const cancelStartedSession = async (
      session: { id: string },
      pipeline?: SegmentationPipelineSession | null,
      durationMs?: number,
    ) => {
      const dictationPromptContext = activeDictationPromptContext;
      activeSession = null;
      activeLivePipeline = null;
      activeDictationPromptContext = null;
      await disposeActiveScreenshotContext();
      dictationPromptContext?.dispose();
      resetDictationPromptState();
      liveProcessingErrorMessage = null;
      liveProcessingQueue = Promise.resolve();
      liveProcessingBacklog = 0;
      await pipeline?.dispose();

      try {
        await options.transcription.cancelSession(session.id);
        await options.sessionStore.markCancelled({ sessionId: session.id, durationMs });
        await options.sessionStore.discardSessionArtifacts(session.id);
      } catch (error) {
        console.error('Toph could not persist the cancelled recording session.', error);
      } finally {
        lifecycle = 'idle';
        options.stateStore.setPhase('idle');
      }
    };

    try {
      const session = await options.sessionStore.createRecordingSession();
      if (!isCurrentOperation(operationGeneration)) {
        await cancelStartedSession(session);
        return;
      }

      liveProcessingGeneration += 1;
      const sessionGeneration = liveProcessingGeneration;
      activeSession = {
        id: session.id,
        rawAudioPath: session.rawAudioPath,
      };
      startScreenshotContext(session);
      const dictationPromptContext = startDictationPromptContext(session);
      const segmentationAudioPath =
        dictationPromptContext?.dictationAudioPath ?? session.rawAudioPath;

      try {
        const pipeline = await options.segmentation.createLiveSession({
          sessionId: session.id,
          rawAudioPath: segmentationAudioPath,
          generateBatchAudio: true,
          onBatchesReady: async (batches) => {
            await Promise.all(batches.map((batch) => options.transcription.onBatchReady(batch.id)));
          },
        });
        if (!isCurrentOperation(operationGeneration)) {
          await cancelStartedSession(session, pipeline);
          return;
        }

        activeLivePipeline = pipeline;
      } catch (error) {
        if (isStreamingVadBusyError(error)) {
          throw error;
        }

        liveProcessingErrorMessage = describeUnexpectedError(
          'Live segmentation could not start unexpectedly.',
          error,
        );
        console.error(liveProcessingErrorMessage, error);
        await options.sessionStore.setProcessingError({
          sessionId: session.id,
          errorMessage: liveProcessingErrorMessage,
        });
        if (!isCurrentOperation(operationGeneration)) {
          await cancelStartedSession(session);
          return;
        }
      }

      await options.audioRecorder.start({
        sessionId: session.id,
        outputPath: session.rawAudioPath,
        onPcmChunk: async (chunk) => {
          const generation = sessionGeneration;
          const pipelineAtEnqueue = activeLivePipeline;
          const dictationPromptAtEnqueue = activeDictationPromptContext;

          if (dictationPromptAtEnqueue?.isCapturing()) {
            try {
              dictationPromptAtEnqueue.writePromptChunk(chunk);
            } catch (error) {
              console.error('Toph could not write Dictation Prompt audio.', error);
              dictationPromptAtEnqueue.stopPromptCapture();
              options.stateStore.setDictationPrompt(
                getDictationPromptState({
                  status: 'error',
                  detail:
                    'Dictation Prompt audio could not be saved. Continuing without that prompt.',
                }),
              );
            }
            return;
          }

          try {
            dictationPromptAtEnqueue?.writeDictationChunk(chunk);
          } catch (error) {
            liveProcessingErrorMessage = describeUnexpectedError(
              'Dictation Prompt audio routing failed while recording.',
              error,
            );
            console.error(liveProcessingErrorMessage, error);
            activeLivePipeline = null;
            await pipelineAtEnqueue?.dispose();
            await options.sessionStore.setProcessingError({
              sessionId: session.id,
              errorMessage: liveProcessingErrorMessage,
            });
            return;
          }

          if (
            generation !== liveProcessingGeneration ||
            liveProcessingErrorMessage ||
            !activeLivePipeline
          ) {
            return;
          }

          if (liveProcessingBacklog >= maxLiveProcessingBacklog) {
            const pipeline = activeLivePipeline;
            liveProcessingErrorMessage = 'Live segmentation fell behind recording and was stopped.';
            console.error(liveProcessingErrorMessage);
            activeLivePipeline = null;
            liveProcessingQueue = liveProcessingQueue.finally(async () => {
              await pipeline.dispose();
            });
            await options.sessionStore.setProcessingError({
              sessionId: session.id,
              errorMessage: liveProcessingErrorMessage,
            });
            return;
          }

          liveProcessingBacklog += 1;
          liveProcessingQueue = liveProcessingQueue
            .then(async () => {
              if (
                generation !== liveProcessingGeneration ||
                pipelineAtEnqueue !== activeLivePipeline ||
                !pipelineAtEnqueue ||
                liveProcessingErrorMessage
              ) {
                return;
              }

              try {
                await pipelineAtEnqueue.processPcmChunk(chunk);
              } catch (error) {
                if (
                  generation !== liveProcessingGeneration ||
                  pipelineAtEnqueue !== activeLivePipeline
                ) {
                  return;
                }

                liveProcessingErrorMessage = describeUnexpectedError(
                  'Live segmentation failed while recording.',
                  error,
                );
                console.error(liveProcessingErrorMessage, error);
                activeLivePipeline = null;
                await pipelineAtEnqueue.dispose();
                await options.sessionStore.setProcessingError({
                  sessionId: session.id,
                  errorMessage: liveProcessingErrorMessage,
                });
              }
            })
            .finally(() => {
              if (generation === liveProcessingGeneration) {
                liveProcessingBacklog -= 1;
              }
            });
          await liveProcessingQueue;
        },
      });
      if (!isCurrentOperation(operationGeneration)) {
        let stoppedRecordingDurationMs: number | undefined;
        try {
          stoppedRecordingDurationMs = (await stopActiveRecorder()).durationMs;
        } catch (error) {
          console.error('Toph could not stop the started recording while cancelling.', error);
        }

        await cancelStartedSession(session, activeLivePipeline, stoppedRecordingDurationMs);
        return;
      }

      lifecycle = 'listening';
      options.stateStore.startListening();
      options.windows.showOverlay();
      options.windows.emitSound('start');
    } catch (error) {
      if (!isCurrentOperation(operationGeneration)) {
        if (activeSession) {
          await cancelStartedSession(activeSession, activeLivePipeline);
        }

        lifecycle = 'idle';
        return;
      }

      if (isStreamingVadBusyError(error)) {
        await failActiveSession(describeBusyVadError(), error);
        return;
      }

      await failActiveSession('Recording could not start unexpectedly.', error);
    }
  };

  const finishListening = async () => {
    const operationGeneration = activeOperationGeneration;
    const session = activeSession;
    if (!session) {
      lifecycle = 'idle';
      options.stateStore.setPhase('idle');
      return;
    }

    options.stateStore.startTranscribing();
    options.windows.emitSound('stop');
    let recordingWasSaved = false;
    let screenshotContext: ScreenshotContextImage[] = [];
    let dictationPromptText: string | null = null;
    let dictationPromptTranscriptionAttempted = false;
    let dictationPromptCaptureResult: {
      promptAudioPath: string | null;
      promptDurationMs: number;
    } | null = null;

    try {
      const recording = await stopActiveRecorder();
      if (!isCurrentOperation(operationGeneration)) {
        return;
      }

      const dictationPromptContext = activeDictationPromptContext;
      activeDictationPromptContext = null;
      dictationPromptCaptureResult = (await dictationPromptContext?.finish()) ?? null;
      if (!isCurrentOperation(operationGeneration)) {
        return;
      }

      screenshotContext = await stopActiveScreenshotContext();
      if (!isCurrentOperation(operationGeneration)) {
        return;
      }

      await liveProcessingQueue;
      if (!isCurrentOperation(operationGeneration)) {
        return;
      }

      const endedAt = Date.now();
      const pipeline = activeLivePipeline;

      await options.sessionStore.markRecorded({
        sessionId: session.id,
        endedAt,
        durationMs: recording.durationMs,
      });
      if (!isCurrentOperation(operationGeneration)) {
        return;
      }

      recordingWasSaved = true;

      if (liveProcessingErrorMessage || !pipeline) {
        const errorMessage = liveProcessingErrorMessage ?? 'Live segmentation did not start.';
        await options.sessionStore.markFailed({ sessionId: session.id, errorMessage });
        await options.transcription.cancelSession(session.id);
        await options.sessionStore.clearSegmentationData(session.id);
        await pipeline?.dispose();
        activeSession = null;
        activeLivePipeline = null;
        liveProcessingErrorMessage = null;
        liveProcessingQueue = Promise.resolve();
        liveProcessingBacklog = 0;
        liveProcessingGeneration += 1;
        lifecycle = 'idle';
        await pruneSessions();
        options.stateStore.failDictation(errorMessage);
        options.windows.showOverlay();
        returnToIdleAfterFailure();
        void refreshRecentSessionsBestEffort();
        return;
      }

      const outcome = await pipeline.flush();
      if (!isCurrentOperation(operationGeneration)) {
        return;
      }

      await pipeline.dispose();
      if (!isCurrentOperation(operationGeneration)) {
        return;
      }

      activeLivePipeline = null;
      liveProcessingQueue = Promise.resolve();
      liveProcessingBacklog = 0;
      liveProcessingGeneration += 1;

      await pruneSessions();
      if (!isCurrentOperation(operationGeneration)) {
        return;
      }

      const getDictationPromptText = async () => {
        if (dictationPromptTranscriptionAttempted) {
          return dictationPromptText;
        }

        dictationPromptTranscriptionAttempted = true;
        dictationPromptText =
          dictationPromptCaptureResult && canUseDictationPrompt()
            ? await transcribeDictationPrompt({
                sessionId: session.id,
                rawAudioPath: session.rawAudioPath,
                promptAudioPath: dictationPromptCaptureResult.promptAudioPath,
                promptDurationMs: dictationPromptCaptureResult.promptDurationMs,
                signal: activePolishAbortController?.signal,
              })
            : null;
        return dictationPromptText;
      };

      if (outcome.result === 'no_speech') {
        activePolishAbortController = new AbortController();
        const promptText = await getDictationPromptText();
        activePolishAbortController = null;
        if (!isCurrentOperation(operationGeneration)) {
          return;
        }

        if (!promptText) {
          await options.sessionStore.markNoSpeech(session.id);
          activeSession = null;
          lifecycle = 'idle';
          await disposeActiveScreenshotContext();
          await completeNoSpeechRecording();
          return;
        }
      }

      await options.sessionStore.markSegmented(session.id);
      if (outcome.result !== 'no_speech') {
        const transcriptionOutcome = await options.transcription.waitForSession(session.id);
        if (!isCurrentOperation(operationGeneration)) {
          return;
        }

        if (transcriptionOutcome.failedOrIncompleteBatchCount > 0) {
          const errorMessage = `${transcriptionOutcome.failedOrIncompleteBatchCount} transcription batch${transcriptionOutcome.failedOrIncompleteBatchCount === 1 ? '' : 'es'} failed or did not finish.`;
          await options.sessionStore.markFailed({ sessionId: session.id, errorMessage });
          activeSession = null;
          lifecycle = 'idle';
          options.stateStore.failDictation(errorMessage);
          options.windows.showOverlay();
          returnToIdleAfterFailure();
          void refreshRecentSessionsBestEffort();
          return;
        }
      }

      let rawOutput: Awaited<ReturnType<SessionOutputService['createRawConcatOutput']>>;
      try {
        rawOutput = await options.outputs.createRawConcatOutput(session.id, {
          allowEmpty: outcome.result === 'no_speech' && !!dictationPromptText,
        });
        if (!isCurrentOperation(operationGeneration)) {
          return;
        }
      } catch (error) {
        if (!isCurrentOperation(operationGeneration)) {
          return;
        }

        const errorMessage = describeUnexpectedError(
          'Raw transcript assembly failed unexpectedly.',
          error,
        );
        await options.sessionStore.markFailed({ sessionId: session.id, errorMessage });
        activeSession = null;
        lifecycle = 'idle';
        options.stateStore.failDictation(errorMessage);
        options.windows.showOverlay();
        returnToIdleAfterFailure();
        void refreshRecentSessionsBestEffort();
        return;
      }

      const polishSettings = options.settingsStore.getSettings().polish;
      if (!polishSettings.enabled) {
        await options.outputs.selectOutput({ sessionId: session.id, outputId: rawOutput.id });
        if (!isCurrentOperation(operationGeneration)) {
          return;
        }

        const pasteAttempt = await options.clipboard.copyAndPasteText(rawOutput.text);
        if (!isCurrentOperation(operationGeneration)) {
          return;
        }

        options.stateStore.completeTranscription(rawOutput.text, pasteAttempt, {
          id: rawOutput.id,
          sessionId: session.id,
          createdAt: rawOutput.createdAt,
          kind: 'raw_concat',
        });
        activeSession = null;
        lifecycle = 'idle';
        options.windows.emitSound('done');
        void refreshDashboardStatsBestEffort();
        void refreshRecentSessionsBestEffort();
        return;
      }

      let polishedOutput: Awaited<ReturnType<PolishService['polishOutput']>>;
      try {
        activePolishAbortController = new AbortController();
        dictationPromptText = await getDictationPromptText();
        activePolishAbortController = null;
        if (!isCurrentOperation(operationGeneration)) {
          return;
        }

        await options.sessionStore.markPolishing(session.id);
        if (!isCurrentOperation(operationGeneration)) {
          return;
        }

        options.stateStore.startPolishing();
        if (!isCurrentOperation(operationGeneration)) {
          return;
        }

        activePolishAbortController = new AbortController();
        polishedOutput = await options.polish.polishOutput({
          sessionId: session.id,
          rawOutput,
          screenshotContext,
          dictationPromptText,
          signal: activePolishAbortController.signal,
        });
        activePolishAbortController = null;
        if (!isCurrentOperation(operationGeneration)) {
          return;
        }

        await options.outputs.selectOutput({ sessionId: session.id, outputId: polishedOutput.id });
        if (!isCurrentOperation(operationGeneration)) {
          return;
        }
      } catch (error) {
        activePolishAbortController = null;
        if (!isCurrentOperation(operationGeneration)) {
          return;
        }

        const errorMessage = describeUnexpectedError('Polish failed unexpectedly.', error);
        await options.sessionStore.markFailed({ sessionId: session.id, errorMessage });
        activeSession = null;
        lifecycle = 'idle';
        options.stateStore.failDictation(errorMessage);
        options.windows.showOverlay();
        returnToIdleAfterFailure();
        void refreshRecentSessionsBestEffort();
        return;
      }

      const pasteAttempt = await options.clipboard.copyAndPasteText(polishedOutput.text);
      if (!isCurrentOperation(operationGeneration)) {
        return;
      }

      options.stateStore.completeTranscription(polishedOutput.text, pasteAttempt, {
        id: polishedOutput.id,
        sessionId: session.id,
        createdAt: polishedOutput.createdAt,
        kind: 'polished',
        rulePresetId: polishedOutput.rulePresetId,
        rulePresetHash: polishedOutput.rulePresetHash,
      });
      activeSession = null;
      lifecycle = 'idle';
      options.windows.emitSound('done');
      void refreshDashboardStatsBestEffort();
      void refreshRecentSessionsBestEffort();
    } catch (error) {
      activePolishAbortController = null;
      if (!isCurrentOperation(operationGeneration)) {
        return;
      }

      if (recordingWasSaved) {
        await failProcessedSession(error);
        return;
      }

      await failActiveSession('Recording could not finish unexpectedly.', error);
    }
  };

  return {
    async toggleCapture() {
      const now = Date.now();
      if (now - lastToggleRequestAt < toggleDebounceMs) {
        return;
      }

      lastToggleRequestAt = now;

      const { phase, ruleSwitcher } = options.stateStore.getState();
      if (ruleSwitcher.mode !== 'idle') {
        return;
      }

      if (lifecycle === 'idle' && phase === 'idle') {
        if (!(await options.ensurePermissionsReady())) {
          return;
        }

        lifecycle = 'starting';
        await beginListening();
        return;
      }

      if (lifecycle === 'listening' && phase === 'listening') {
        lifecycle = 'stopping';
        await runFinishListening();
      }
    },

    async cancelCapture() {
      clearFailureTimer();
      clearNoSpeechTimer();

      const previousLifecycle = lifecycle;
      const session = activeSession;
      const pipeline = activeLivePipeline;
      const screenshotContext = activeScreenshotContext;
      const dictationPromptContext = activeDictationPromptContext;
      const pendingLiveProcessing = liveProcessingQueue;
      const pendingFinish = activeFinishTask;
      const shouldStopRecorder =
        lifecycle === 'starting' || lifecycle === 'listening' || Boolean(activeRecorderStop);
      activePolishAbortController?.abort();
      activePolishAbortController = null;
      activeOperationGeneration += 1;
      lifecycle = 'cancelling';
      options.stateStore.setPhase('idle');
      options.windows.showOverlay();

      if (previousLifecycle === 'starting' || previousLifecycle === 'cancelling') {
        return;
      }

      activeSession = null;
      activeLivePipeline = null;
      activeScreenshotContext = null;
      activeDictationPromptContext = null;
      liveProcessingErrorMessage = null;
      liveProcessingQueue = Promise.resolve();
      liveProcessingBacklog = 0;
      liveProcessingGeneration += 1;

      if (!session) {
        lifecycle = 'idle';
        return;
      }

      let stoppedRecordingDurationMs: number | undefined;
      if (shouldStopRecorder) {
        try {
          stoppedRecordingDurationMs = (await stopActiveRecorder()).durationMs;
        } catch (error) {
          console.error('Toph could not stop the active recording while cancelling.', error);
        }
      }

      await pendingLiveProcessing.catch((queueError: unknown) => {
        console.error('Toph live segmentation queue failed while cancelling.', queueError);
      });
      await screenshotContext?.dispose().catch((screenshotError: unknown) => {
        console.error('Toph screenshot context capture failed while cancelling.', screenshotError);
      });
      dictationPromptContext?.dispose();
      resetDictationPromptState();

      try {
        // A flush may schedule batches while cancel is waiting for finish cleanup;
        // cancel both sides of that wait so no transcriptions survive cancellation.
        await options.transcription.cancelSession(session.id);
        await pendingFinish?.catch((finishError: unknown) => {
          console.error('Toph finishing pipeline failed while cancelling.', finishError);
        });
        await options.transcription.cancelSession(session.id);
        await pipeline?.dispose();
        if (session.preserveArtifactsOnCancel) {
          await options.sessionStore.clearSegmentationData(session.id, {
            preserveSelectedOutput: true,
          });
          if (session.rerunOutputId) {
            await options.outputs.selectOutput({
              sessionId: session.id,
              outputId: session.rerunOutputId,
            });
          }
        } else {
          await options.sessionStore.markCancelled({
            sessionId: session.id,
            durationMs: stoppedRecordingDurationMs,
          });
          await options.sessionStore.discardSessionArtifacts(session.id);
        }
      } catch (error) {
        console.error('Toph could not persist the cancelled recording session.', error);
      } finally {
        lifecycle = 'idle';
      }
    },

    async captureScreenshotContext() {
      const screenshotContext = activeScreenshotContext;
      if (lifecycle !== 'listening' || options.stateStore.getState().phase !== 'listening') {
        return;
      }

      try {
        await screenshotContext?.capture();
      } catch (error) {
        console.error('Toph could not capture manual screenshot context.', error);
      }
    },

    async toggleDictationPromptCapture() {
      const dictationPromptContext = activeDictationPromptContext;
      if (
        lifecycle !== 'listening' ||
        options.stateStore.getState().phase !== 'listening' ||
        !canUseDictationPrompt() ||
        !dictationPromptContext
      ) {
        resetDictationPromptState();
        return;
      }

      if (dictationPromptContext.isCapturing()) {
        dictationPromptContext.stopPromptCapture();
        options.stateStore.setDictationPrompt(
          getDictationPromptState({
            status: 'captured',
            detail: 'Dictation Prompt saved. Keep dictating or stop to apply it.',
          }),
        );
        return;
      }

      dictationPromptContext.startPromptCapture();
      options.stateStore.setDictationPrompt(
        getDictationPromptState({
          status: 'capturing',
          detail: 'Listening for Dictation Prompt instructions...',
        }),
      );
    },

    async rerunSession(sessionId) {
      await rerunRecordedWorkflow(sessionId);
    },

    async dispose() {
      clearFailureTimer();
      clearNoSpeechTimer();
      const session = activeSession;
      const pipeline = activeLivePipeline;
      const screenshotContext = activeScreenshotContext;
      const dictationPromptContext = activeDictationPromptContext;
      const pendingLiveProcessing = liveProcessingQueue;
      activeSession = null;
      activeLivePipeline = null;
      activeScreenshotContext = null;
      activeDictationPromptContext = null;
      liveProcessingErrorMessage = null;
      liveProcessingQueue = Promise.resolve();
      liveProcessingBacklog = 0;
      liveProcessingGeneration += 1;
      activeOperationGeneration += 1;
      lifecycle = 'idle';
      activePolishAbortController?.abort();
      activePolishAbortController = null;
      options.audioRecorder.dispose();
      await pendingLiveProcessing.catch((queueError: unknown) => {
        console.error('Toph live segmentation queue failed during shutdown.', queueError);
      });
      await pipeline?.dispose();
      await screenshotContext?.dispose().catch((screenshotError: unknown) => {
        console.error('Toph screenshot context capture failed during shutdown.', screenshotError);
      });
      dictationPromptContext?.dispose();
      resetDictationPromptState();

      if (session) {
        try {
          await options.sessionStore.markRecordingFailed({
            sessionId: session.id,
            errorMessage: 'Recording was interrupted because Toph is quitting.',
          });
          await options.transcription.cancelSession(session.id);
          await options.sessionStore.clearSegmentationData(session.id);
          await pruneSessions();
        } catch (error) {
          console.error('Toph could not fail the active recording session during shutdown.', error);
        }
      }
    },
  };
}
