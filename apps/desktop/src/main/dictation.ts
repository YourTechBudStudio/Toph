import { existsSync } from 'node:fs';

import type {
  ActiveInputDeviceFallback,
  PasteAttempt,
} from '@toph/desktop-contracts';

import { resolveDictationRetryStrategy } from './dictation-retry-strategy';
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
  rerunSession: (sessionId: string) => Promise<void>;
  dispose: () => Promise<void>;
}

const toggleDebounceMs = 800;
const failureVisibleMs = 2_000;
const copiedVisibleMs = 2_000;
const noSpeechVisibleMs = 2_000;
const cancelledVisibleMs = 1_200;
const maxLiveProcessingBacklog = 100;
type DictationLifecycle = 'idle' | 'starting' | 'listening' | 'stopping' | 'cancelling';
type RerunDelivery = 'copy-and-paste';

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
    | 'getSession'
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
  audioRecorder: RawAudioRecorder;
  clipboard: ClipboardManager;
  ensurePermissionsReady: () => Promise<boolean>;
  windows: Pick<WindowManager, 'showOverlay' | 'emitSound'>;
  onPasteSupportMayHaveChanged: () => Promise<void>;
  onDashboardStatsChanged: () => Promise<void>;
  onRecentSessionsChanged: () => Promise<void>;
}): DictationController {
  let failureTimer: ReturnType<typeof setTimeout> | null = null;
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;
  let noSpeechTimer: ReturnType<typeof setTimeout> | null = null;
  let cancelledTimer: ReturnType<typeof setTimeout> | null = null;
  let lastToggleRequestAt = 0;
  let activeSession: {
    id: string;
    rawAudioPath: string;
    preserveArtifactsOnCancel?: boolean;
    clearGeneratedDataOnCancel?: boolean;
    rerunOutputId?: string | null;
    rerunRestoreErrorMessage?: string | null;
    rerunRestoreNoSpeech?: boolean;
  } | null = null;
  let activeLivePipeline: SegmentationPipelineSession | null = null;
  let liveProcessingErrorMessage: string | null = null;
  let liveProcessingQueue: Promise<void> = Promise.resolve();
  let liveProcessingBacklog = 0;
  let liveProcessingGeneration = 0;
  let activeOperationGeneration = 0;
  let activeRecorderStop: Promise<Awaited<ReturnType<RawAudioRecorder['stop']>>> | null = null;
  let activeFinishTask: Promise<void> | null = null;
  let lifecycle: DictationLifecycle = 'idle';
  let activePolishAbortController: AbortController | null = null;

  const clearFailureTimer = () => {
    if (!failureTimer) {
      return;
    }

    clearTimeout(failureTimer);
    failureTimer = null;
  };

  const clearCopiedTimer = () => {
    if (!copiedTimer) {
      return;
    }

    clearTimeout(copiedTimer);
    copiedTimer = null;
  };

  const clearNoSpeechTimer = () => {
    if (!noSpeechTimer) {
      return;
    }

    clearTimeout(noSpeechTimer);
    noSpeechTimer = null;
  };

  const clearCancelledTimer = () => {
    if (!cancelledTimer) {
      return;
    }

    clearTimeout(cancelledTimer);
    cancelledTimer = null;
  };

  const returnToIdleAfterFailure = () => {
    clearFailureTimer();
    const activeFailure = options.stateStore.getState().activeFailure;
    if (activeFailure?.canRetry) {
      return;
    }

    failureTimer = setTimeout(() => {
      failureTimer = null;
      options.stateStore.setPhase('idle');
    }, failureVisibleMs);
  };

  const returnToIdleAfterCopied = () => {
    clearCopiedTimer();
    copiedTimer = setTimeout(() => {
      copiedTimer = null;
      if (options.stateStore.getState().phase === 'copied') {
        options.stateStore.setPhase('idle');
      }
    }, copiedVisibleMs);
  };

  const returnToIdleAfterNoSpeech = () => {
    clearNoSpeechTimer();
    noSpeechTimer = setTimeout(() => {
      noSpeechTimer = null;
      options.stateStore.setPhase('idle');
    }, noSpeechVisibleMs);
  };

  const returnToIdleAfterCancellation = () => {
    clearCancelledTimer();
    cancelledTimer = setTimeout(() => {
      cancelledTimer = null;
      if (options.stateStore.getState().phase === 'cancelled') {
        options.stateStore.setPhase('idle');
      }
    }, cancelledVisibleMs);
  };

  const failProcessedSession = async (error: unknown) => {
    const session = activeSession;
    const pipeline = activeLivePipeline;
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
    liveProcessingErrorMessage = null;
    liveProcessingQueue = Promise.resolve();
    liveProcessingBacklog = 0;
    liveProcessingGeneration += 1;
    lifecycle = 'idle';
    await pipeline?.dispose();
    console.error('Toph could not complete live segmentation for the recording session.', error);
    options.stateStore.failDictation('Unable to transcribe.', {
      sessionId: session?.id ?? null,
      canRetry: session ? existsSync(session.rawAudioPath) : false,
    });
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
    const pendingLiveProcessing = liveProcessingQueue;
    activeSession = null;
    activeLivePipeline = null;
    liveProcessingErrorMessage = null;
    liveProcessingQueue = Promise.resolve();
    liveProcessingBacklog = 0;
    liveProcessingGeneration += 1;
    lifecycle = 'idle';

    await pendingLiveProcessing.catch((queueError: unknown) => {
      console.error('Toph live segmentation queue failed while recording was failing.', queueError);
    });
    await failedPipeline?.dispose();

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
    options.stateStore.failDictation(message, {
      sessionId: failedSession?.id ?? null,
      canRetry: failedSession ? existsSync(failedSession.rawAudioPath) : false,
    });
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

  const currentTranscriptionSnapshot = () => {
    const transcription = options.settingsStore.getSettings().transcription;
    return {
      transcriptionProviderId: transcription.providerId,
      transcriptionModel: transcription.model,
    };
  };

  const restoreRerunBaseline = async (input: {
    sessionId: string;
    existingOutputId: string | null;
    restoreErrorMessage?: string | null;
    restoreNoSpeech?: boolean;
  }) => {
    if (input.existingOutputId) {
      await options.outputs.selectOutput({
        sessionId: input.sessionId,
        outputId: input.existingOutputId,
      });
      return;
    }

    if (input.restoreErrorMessage) {
      await options.sessionStore.markFailed({
        sessionId: input.sessionId,
        errorMessage: input.restoreErrorMessage,
      });
      return;
    }

    if (input.restoreNoSpeech) {
      await options.sessionStore.markNoSpeech(input.sessionId);
    }
  };

  const restoreExistingOutput = async (sessionId: string, existingOutputId: string | null) => {
    await restoreRerunBaseline({ sessionId, existingOutputId });
  };

  type CompletedRerunOutput = {
    id: string;
    text: string;
    createdAt: number;
    kind: 'raw_concat' | 'polished';
    rulePresetId: string | null;
    rulePresetHash: string | null;
  };

  const transcriptWasCopied = (pasteAttempt: PasteAttempt) => {
    if (typeof pasteAttempt.copiedToClipboard === 'boolean') {
      return pasteAttempt.copiedToClipboard;
    }

    return pasteAttempt.status === 'success' || pasteAttempt.status === 'clipboard-only';
  };

  const copiedPasteAttempt = (pasteAttempt: PasteAttempt): PasteAttempt => ({
    helper: pasteAttempt.helper,
    status: 'clipboard-only',
    detail: 'Transcription copied.',
    copiedToClipboard: true,
  });

  const completeRerunOutput = async (input: {
    sessionId: string;
    existingOutputId: string | null;
    operationGeneration: number;
    delivery?: RerunDelivery;
    output: CompletedRerunOutput;
  }) => {
    await options.outputs.selectOutput({
      sessionId: input.sessionId,
      outputId: input.output.id,
    });
    if (!isCurrentOperation(input.operationGeneration)) {
      await restoreExistingOutput(input.sessionId, input.existingOutputId);
      return;
    }

    if (input.delivery === 'copy-and-paste') {
      const pasteAttempt = await options.clipboard.copyAndPasteText(input.output.text);
      void options.onPasteSupportMayHaveChanged();
      if (!isCurrentOperation(input.operationGeneration)) {
        await restoreExistingOutput(input.sessionId, input.existingOutputId);
        return;
      }

      activeSession = null;
      lifecycle = 'idle';

      const copied = transcriptWasCopied(pasteAttempt);
      const presentation = pasteAttempt.status === 'success' || !copied ? 'idle' : 'copied';
      options.stateStore.completeTranscription(
        input.output.text,
        copied && presentation === 'copied' ? copiedPasteAttempt(pasteAttempt) : pasteAttempt,
        {
          id: input.output.id,
          sessionId: input.sessionId,
          createdAt: input.output.createdAt,
          kind: input.output.kind,
          rulePresetId: input.output.rulePresetId,
          rulePresetHash: input.output.rulePresetHash,
          presentation,
        },
      );
      if (copied && presentation === 'copied') {
        returnToIdleAfterCopied();
      }
      options.windows.emitSound('done');
      void refreshRecentSessionsBestEffort();
      return;
    }

    activeSession = null;
    lifecycle = 'idle';
    options.stateStore.setPhase('idle');
    options.windows.emitSound('done');
    void refreshRecentSessionsBestEffort();
  };

  const completeRerunFromExistingTranscripts = async (input: {
    sessionId: string;
    existingOutputId: string | null;
    operationGeneration: number;
    delivery?: RerunDelivery;
  }) => {
    const polishSettings = options.settingsStore.getSettings().polish;
    if (!polishSettings.enabled) {
      const rawOutput = await options.outputs.createRawConcatOutput(
        input.sessionId,
        input.existingOutputId ? { outputId: input.existingOutputId } : undefined,
      );
      if (!isCurrentOperation(input.operationGeneration)) {
        await restoreExistingOutput(input.sessionId, input.existingOutputId);
        return;
      }

      await completeRerunOutput({
        sessionId: input.sessionId,
        existingOutputId: input.existingOutputId,
        operationGeneration: input.operationGeneration,
        delivery: input.delivery,
        output: {
          ...rawOutput,
          kind: 'raw_concat',
          rulePresetId: null,
          rulePresetHash: null,
        },
      });
      return;
    }

    const rawOutput = await options.outputs.createRawConcatOutput(input.sessionId);
    if (!isCurrentOperation(input.operationGeneration)) {
      await restoreExistingOutput(input.sessionId, input.existingOutputId);
      return;
    }

    await options.sessionStore.markPolishing(input.sessionId);
    options.stateStore.startPolishing();
    if (!isCurrentOperation(input.operationGeneration)) {
      await restoreExistingOutput(input.sessionId, input.existingOutputId);
      return;
    }

    activePolishAbortController = new AbortController();
    const polishedOutput = await options.polish.polishOutput({
      sessionId: input.sessionId,
      rawOutput,
      signal: activePolishAbortController.signal,
      outputId: input.existingOutputId ?? undefined,
    });
    activePolishAbortController = null;
    if (!isCurrentOperation(input.operationGeneration)) {
      await restoreExistingOutput(input.sessionId, input.existingOutputId);
      return;
    }

    await completeRerunOutput({
      sessionId: input.sessionId,
      existingOutputId: input.existingOutputId,
      operationGeneration: input.operationGeneration,
      delivery: input.delivery,
      output: { ...polishedOutput, kind: 'polished' },
    });
  };

  const runFullRecordedWorkflowRerun = async (input: {
    requestedSessionId: string;
    rawAudioPath: string;
    existingOutputId: string | null;
    restoreErrorMessage: string | null;
    restoreNoSpeech: boolean;
    operationGeneration: number;
    delivery?: RerunDelivery;
  }) => {
    activeSession = {
      id: input.requestedSessionId,
      rawAudioPath: input.rawAudioPath,
      preserveArtifactsOnCancel: true,
      rerunOutputId: input.existingOutputId,
      clearGeneratedDataOnCancel: true,
      rerunRestoreErrorMessage: input.restoreErrorMessage,
      rerunRestoreNoSpeech: input.restoreNoSpeech,
    };

    const prepared = await options.sessionStore.prepareSessionForRerun(
      input.requestedSessionId,
      currentTranscriptionSnapshot(),
    );
    const sessionId = prepared.session.id;
    const existingOutputId = prepared.outputId;
    activeSession = {
      id: prepared.session.id,
      rawAudioPath: prepared.session.rawAudioPath,
      preserveArtifactsOnCancel: true,
      rerunOutputId: existingOutputId,
      clearGeneratedDataOnCancel: true,
      rerunRestoreErrorMessage: input.restoreErrorMessage,
      rerunRestoreNoSpeech: input.restoreNoSpeech,
    };
    if (!isCurrentOperation(input.operationGeneration)) {
      activeSession = null;
      lifecycle = 'idle';
      await restoreRerunBaseline({
        sessionId,
        existingOutputId,
        restoreErrorMessage: input.restoreErrorMessage,
        restoreNoSpeech: input.restoreNoSpeech,
      });
      return;
    }

    const segmentationOutcome = await options.segmentation.segmentRecordedSession({
      sessionId,
      generateBatchAudio: true,
      preserveSelectedOutput: true,
    });
    if (!isCurrentOperation(input.operationGeneration)) {
      activeSession = null;
      lifecycle = 'idle';
      await options.sessionStore.clearSegmentationData(sessionId, {
        preserveSelectedOutput: true,
      });
      await restoreRerunBaseline({
        sessionId,
        existingOutputId,
        restoreErrorMessage: input.restoreErrorMessage,
        restoreNoSpeech: input.restoreNoSpeech,
      });
      return;
    }

    if (segmentationOutcome === 'no_speech') {
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
    if (!isCurrentOperation(input.operationGeneration)) {
      activeSession = null;
      lifecycle = 'idle';
      await options.sessionStore.clearSegmentationData(sessionId, {
        preserveSelectedOutput: true,
      });
      await restoreRerunBaseline({
        sessionId,
        existingOutputId,
        restoreErrorMessage: input.restoreErrorMessage,
        restoreNoSpeech: input.restoreNoSpeech,
      });
      return;
    }

    if (transcriptionOutcome.failedOrIncompleteBatchCount > 0) {
      throw new Error(
        `${transcriptionOutcome.failedOrIncompleteBatchCount} transcription batch${transcriptionOutcome.failedOrIncompleteBatchCount === 1 ? '' : 'es'} failed or did not finish.`,
      );
    }

    await completeRerunFromExistingTranscripts({
      sessionId,
      existingOutputId,
      operationGeneration: input.operationGeneration,
      delivery: input.delivery,
    });
  };

  const runPartialTranscriptionRetry = async (input: {
    sessionId: string;
    batchIds: string[];
    existingOutputId: string | null;
    operationGeneration: number;
    delivery?: RerunDelivery;
  }) => {
    await options.sessionStore.markSegmented(input.sessionId);
    await Promise.all(
      input.batchIds.map((batchId) =>
        options.transcription.onBatchReady(batchId, { resetAttempts: true }),
      ),
    );
    const transcriptionOutcome = await options.transcription.waitForSession(input.sessionId);
    if (!isCurrentOperation(input.operationGeneration)) {
      return;
    }

    if (transcriptionOutcome.failedOrIncompleteBatchCount > 0) {
      throw new Error(
        `${transcriptionOutcome.failedOrIncompleteBatchCount} transcription batch${transcriptionOutcome.failedOrIncompleteBatchCount === 1 ? '' : 'es'} failed or did not finish.`,
      );
    }

    await completeRerunFromExistingTranscripts({
      sessionId: input.sessionId,
      existingOutputId: input.existingOutputId,
      operationGeneration: input.operationGeneration,
      delivery: input.delivery,
    });
  };

  const rerunRecordedWorkflow = async (requestedSessionId: string) => {
    const { phase, ruleSwitcher, activeFailure } = options.stateStore.getState();
    const retryingVisibleFailure =
      phase === 'failed' &&
      activeFailure?.canRetry &&
      activeFailure.sessionId === requestedSessionId;
    const delivery: RerunDelivery | undefined = retryingVisibleFailure
      ? 'copy-and-paste'
      : undefined;
    if (
      lifecycle !== 'idle' ||
      (phase !== 'idle' && !retryingVisibleFailure) ||
      ruleSwitcher.mode !== 'idle'
    ) {
      return;
    }
    if (!(await options.ensurePermissionsReady())) {
      return;
    }

    clearFailureTimer();
    clearCopiedTimer();
    clearNoSpeechTimer();
    clearCancelledTimer();
    activeOperationGeneration += 1;
    const operationGeneration = activeOperationGeneration;
    lifecycle = 'stopping';
    options.stateStore.startTranscribing();
    options.windows.showOverlay();

    let sessionId: string | null = requestedSessionId;
    let existingOutputId: string | null = null;
    let retryableSession = false;

    try {
      const session = await options.sessionStore.getSession(requestedSessionId);
      if (!session) {
        throw new Error(`Session ${requestedSessionId} is not available.`);
      }
      if (!existsSync(session.rawAudioPath)) {
        throw new Error(`Session ${requestedSessionId} no longer has retained audio.`);
      }
      retryableSession = true;

      sessionId = session.id;
      existingOutputId = session.selectedOutputId;
      activeSession = {
        id: session.id,
        rawAudioPath: session.rawAudioPath,
        preserveArtifactsOnCancel: true,
        rerunOutputId: existingOutputId,
        clearGeneratedDataOnCancel: false,
        rerunRestoreErrorMessage: session.errorMessage,
        rerunRestoreNoSpeech: session.status === 'no_speech',
      };

      const batches = await options.sessionStore.listTranscriptionBatchesForSession(session.id);
      const strategy = resolveDictationRetryStrategy({
        session,
        batches,
        settings: options.settingsStore.getSettings(),
        batchAudioExists: existsSync,
      });

      if (strategy.kind === 'not-retryable') {
        throw new Error(strategy.reason);
      }

      if (strategy.kind === 'full-rerun') {
        await runFullRecordedWorkflowRerun({
          requestedSessionId,
          rawAudioPath: session.rawAudioPath,
          existingOutputId,
          restoreErrorMessage: session.errorMessage,
          restoreNoSpeech: session.status === 'no_speech',
          operationGeneration,
          delivery,
        });
        return;
      }

      if (strategy.kind === 'retry-failed-transcription-batches') {
        await runPartialTranscriptionRetry({
          sessionId: session.id,
          batchIds: strategy.batchIds,
          existingOutputId,
          operationGeneration,
          delivery,
        });
        return;
      }

      await completeRerunFromExistingTranscripts({
        sessionId: session.id,
        existingOutputId,
        operationGeneration,
        delivery,
      });
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
        if (existingOutputId) {
          await restoreExistingOutput(sessionId, existingOutputId);
        } else {
          await options.sessionStore.markFailed({ sessionId, errorMessage });
        }
      }
      options.stateStore.failDictation(errorMessage, {
        sessionId,
        canRetry: retryableSession,
      });
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
    clearCopiedTimer();
    clearNoSpeechTimer();
    clearCancelledTimer();
    liveProcessingErrorMessage = null;
    activeOperationGeneration += 1;
    const operationGeneration = activeOperationGeneration;

    const cancelStartedSession = async (
      session: { id: string },
      pipeline?: SegmentationPipelineSession | null,
      durationMs?: number,
    ) => {
      activeSession = null;
      activeLivePipeline = null;
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
        if (options.stateStore.getState().phase !== 'cancelled') {
          options.stateStore.setPhase('idle');
        }
      }
    };

    try {
      const transcriptionSettings = options.settingsStore.getSettings().transcription;
      const session = await options.sessionStore.createRecordingSession({
        transcriptionProviderId: transcriptionSettings.providerId,
        transcriptionModel: transcriptionSettings.model,
      });
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

      try {
        const pipeline = await options.segmentation.createLiveSession({
          sessionId: session.id,
          rawAudioPath: session.rawAudioPath,
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

      const inputDevicePreference = options.settingsStore.getSettings().audio.inputDevice;
      const inputDeviceFallbackRef: { current: ActiveInputDeviceFallback | null } = {
        current: null,
      };
      await options.audioRecorder.start({
        sessionId: session.id,
        outputPath: session.rawAudioPath,
        inputDeviceId: inputDevicePreference.id === 'default' ? null : inputDevicePreference.id,
        onInputDeviceFallback: ({ defaultLabel }) => {
          inputDeviceFallbackRef.current = {
            selectedLabel: inputDevicePreference.label,
            defaultLabel,
          };
          const defaultInputDescription = defaultLabel
            ? `system default microphone (${defaultLabel})`
            : 'system default microphone';
          console.warn(
            `${inputDevicePreference.label ?? 'Selected microphone'} is unavailable. Recording with the ${defaultInputDescription}.`,
          );
        },
        onPcmChunk: async (chunk) => {
          const generation = sessionGeneration;
          const pipelineAtEnqueue = activeLivePipeline;
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
      const inputDeviceFallback = inputDeviceFallbackRef.current;
      options.stateStore.startListening(
        inputDeviceFallback
          ? {
              detail: `Using default input${inputDeviceFallback.defaultLabel ? ` - ${inputDeviceFallback.defaultLabel}` : ''}.`,
              inputDeviceFallback,
            }
          : undefined,
      );
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

    try {
      const recording = await stopActiveRecorder();
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
        options.stateStore.failDictation(errorMessage, { sessionId: session.id, canRetry: true });
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

      if (outcome.result === 'no_speech') {
        await options.sessionStore.markNoSpeech(session.id);
        activeSession = null;
        lifecycle = 'idle';
        await completeNoSpeechRecording();
        return;
      }

      await options.sessionStore.markSegmented(session.id);
      const transcriptionOutcome = await options.transcription.waitForSession(session.id);
      if (!isCurrentOperation(operationGeneration)) {
        return;
      }

      if (transcriptionOutcome.failedOrIncompleteBatchCount > 0) {
        const errorMessage = `${transcriptionOutcome.failedOrIncompleteBatchCount} transcription batch${transcriptionOutcome.failedOrIncompleteBatchCount === 1 ? '' : 'es'} failed or did not finish.`;
        await options.sessionStore.markFailed({ sessionId: session.id, errorMessage });
        activeSession = null;
        lifecycle = 'idle';
        options.stateStore.failDictation(errorMessage, { sessionId: session.id, canRetry: true });
        options.windows.showOverlay();
        returnToIdleAfterFailure();
        void refreshRecentSessionsBestEffort();
        return;
      }

      let rawOutput: Awaited<ReturnType<SessionOutputService['createRawConcatOutput']>>;
      try {
        rawOutput = await options.outputs.createRawConcatOutput(session.id);
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
        options.stateStore.failDictation(errorMessage, { sessionId: session.id, canRetry: true });
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
        void options.onPasteSupportMayHaveChanged();
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
        options.stateStore.failDictation(errorMessage, { sessionId: session.id, canRetry: true });
        options.windows.showOverlay();
        returnToIdleAfterFailure();
        void refreshRecentSessionsBestEffort();
        return;
      }

      const pasteAttempt = await options.clipboard.copyAndPasteText(polishedOutput.text);
      void options.onPasteSupportMayHaveChanged();
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

  const cancelCapture = async () => {
    clearFailureTimer();
    clearCopiedTimer();
    clearNoSpeechTimer();
    clearCancelledTimer();

    const currentPhase = options.stateStore.getState().phase;
    const previousLifecycle = lifecycle;
    const session = activeSession;
    const pipeline = activeLivePipeline;
    const pendingLiveProcessing = liveProcessingQueue;
    const pendingFinish = activeFinishTask;
    const shouldStopRecorder =
      lifecycle === 'starting' || lifecycle === 'listening' || Boolean(activeRecorderStop);

    if (!session && lifecycle === 'idle') {
      if (
        currentPhase === 'failed' ||
        currentPhase === 'copied' ||
        currentPhase === 'no_speech' ||
        currentPhase === 'cancelled'
      ) {
        options.stateStore.setPhase('idle');
      }
      return;
    }

    activePolishAbortController?.abort();
    activePolishAbortController = null;
    activeOperationGeneration += 1;
    lifecycle = 'cancelling';
    options.stateStore.cancelDictation();
    options.windows.showOverlay();

    if (previousLifecycle === 'starting' || previousLifecycle === 'cancelling') {
      returnToIdleAfterCancellation();
      return;
    }

    activeSession = null;
    activeLivePipeline = null;
    liveProcessingErrorMessage = null;
    liveProcessingQueue = Promise.resolve();
    liveProcessingBacklog = 0;
    liveProcessingGeneration += 1;

    if (!session) {
      lifecycle = 'idle';
      returnToIdleAfterCancellation();
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
        if (session.clearGeneratedDataOnCancel !== false) {
          await options.sessionStore.clearSegmentationData(session.id, {
            preserveSelectedOutput: true,
          });
        }
        await restoreRerunBaseline({
          sessionId: session.id,
          existingOutputId: session.rerunOutputId ?? null,
          restoreErrorMessage: session.rerunRestoreErrorMessage,
          restoreNoSpeech: session.rerunRestoreNoSpeech,
        });
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
      await pruneSessions();
      await refreshRecentSessionsBestEffort();
      returnToIdleAfterCancellation();
    }
  };

  return {
    async toggleCapture() {
      const { phase, ruleSwitcher } = options.stateStore.getState();
      if (ruleSwitcher.mode !== 'idle') {
        return;
      }

      if (
        phase === 'failed' ||
        phase === 'copied' ||
        phase === 'no_speech' ||
        phase === 'cancelled'
      ) {
        await cancelCapture();
        return;
      }

      if (phase === 'transcribing' || phase === 'polishing') {
        await cancelCapture();
        return;
      }

      const now = Date.now();
      if (now - lastToggleRequestAt < toggleDebounceMs) {
        return;
      }

      lastToggleRequestAt = now;

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
        return;
      }
    },

    cancelCapture,

    async rerunSession(sessionId) {
      await rerunRecordedWorkflow(sessionId);
    },

    async dispose() {
      clearFailureTimer();
      clearCopiedTimer();
      clearNoSpeechTimer();
      clearCancelledTimer();
      const session = activeSession;
      const pipeline = activeLivePipeline;
      const pendingLiveProcessing = liveProcessingQueue;
      activeSession = null;
      activeLivePipeline = null;
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
