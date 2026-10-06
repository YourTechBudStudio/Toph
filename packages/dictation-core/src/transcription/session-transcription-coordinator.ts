import { createId } from '../ids';
import { toProviderUsageEvent, type ProviderUsageEventRecord } from '../usage/provider-usage';
import {
  isTransientTranscriptionProviderError,
  type TranscriptionClient,
  type TranscriptionClientResult,
} from './transcription-client';

export type TranscriptionBatchStatus = 'planned' | 'transcribing' | 'transcribed' | 'failed';

/** The batch fields the coordinator reads. Desktop's `TranscriptionBatch` row satisfies it. */
export interface TranscriptionBatchRecord {
  id: string;
  sessionId: string;
  status: TranscriptionBatchStatus;
  transcriptionAttempts: number;
  derivedAudioPath: string | null;
  derivedAudioDurationMs: number;
}

/**
 * One `batch_transcripts` row. Mirrors the desktop schema until the schema itself moves into shared
 * code.
 */
export interface BatchTranscriptRecord {
  id: string;
  batchId: string;
  provider: string;
  model: string | null;
  text: string;
  createdAt: number;
}

/**
 * The persistence the coordinator needs. Desktop's `RecordingSessionStore` satisfies it as is.
 * Members are function-typed properties, not methods, so `strict` checks their parameters
 * contravariantly and a drift between these records and the host's rows fails the host's typecheck.
 */
export interface TranscriptionStore {
  getSession: (sessionId: string) => Promise<{
    transcriptionProviderId: string | null;
    transcriptionModel: string | null;
  } | null>;
  getTranscriptionBatch: (batchId: string) => Promise<TranscriptionBatchRecord | null>;
  listTranscriptionBatchesForSession: (
    sessionId: string,
  ) => Promise<Array<Pick<TranscriptionBatchRecord, 'status'>>>;
  markBatchTranscribing: (options: {
    batchId: string;
    attempts: number;
    startedAt: number;
  }) => Promise<void>;
  markBatchTranscribed: (options: { batchId: string; transcribedAt: number }) => Promise<void>;
  markBatchFailed: (options: {
    batchId: string;
    attempts: number;
    errorMessage: string;
  }) => Promise<void>;
  createBatchTranscript: (options: {
    transcript: BatchTranscriptRecord;
    usageEvent: ProviderUsageEventRecord;
  }) => Promise<void>;
}

export type BatchSkipReason = 'already_tracked' | 'missing_row' | 'already_transcribed';

/** Every event the coordinator records. */
export type TranscriptionCoordinatorEvent =
  /** `onBatchReady` was entered for a batch. */
  | { kind: 'batch_received'; batchId: string; resetAttempts: boolean }
  /** `onBatchReady` returned without creating a task. */
  | { kind: 'batch_skipped'; batchId: string; reason: BatchSkipReason }
  /**
   * The transcription task body was entered. An async function body runs synchronously up to its
   * first `await` and `record` never returns a promise, so this always lands in the same tick as
   * the `batch_received` that precedes it. It records that a task was *created*, not that the task
   * made progress — read `batch_session_loaded` for that.
   */
  | { kind: 'batch_task_created'; sessionId: string; batchId: string }
  /**
   * The `getSession` read inside `transcribeBatch` resolved. This is the only `await` between task
   * creation and the first attempt; everything after it up to the attempt loop is synchronous. So
   * the gap either side of this event says directly whether a stall sits inside the store read or
   * before the attempt loop, rather than leaving it to be inferred from an absence.
   */
  | { kind: 'batch_session_loaded'; sessionId: string; batchId: string }
  /** The task body returned, whether by success, failure or abort. */
  | { kind: 'batch_task_settled'; sessionId: string; batchId: string }
  | { kind: 'batch_attempt_started'; sessionId: string; batchId: string; attempt: number }
  | {
      kind: 'batch_attempt_succeeded';
      sessionId: string;
      batchId: string;
      attempt: number;
      providerDurationMs: number;
    }
  | {
      kind: 'batch_attempt_failed';
      sessionId: string;
      batchId: string;
      attempt: number;
      transient: boolean;
      message: string;
    }
  | {
      kind: 'batch_failed';
      sessionId: string;
      batchId: string;
      attempts: number;
      message: string;
    };

export interface SessionTranscriptionCoordinator {
  onBatchReady: (batchId: string, options?: { resetAttempts?: boolean }) => Promise<void>;
  cancelSession: (sessionId: string) => Promise<void>;
  waitForSession: (sessionId: string) => Promise<SessionTranscriptionOutcome>;
  dispose: () => Promise<void>;
}

export interface SessionTranscriptionOutcome {
  failedOrIncompleteBatchCount: number;
}

const maxAttempts = 3;
const retryDelayMs = 1_000;

function describeError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown transcription error.';
}

function isTranscriptionAbortError(error: unknown) {
  return error instanceof Error && error.message === 'Transcription was aborted.';
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Transcription was aborted.'));
      return;
    }

    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(new Error('Transcription was aborted.'));
      },
      { once: true },
    );
  });
}

function toTranscriptRows(options: {
  sessionId: string;
  batchId: string;
  result: TranscriptionClientResult;
  createdAt: number;
}): { transcript: BatchTranscriptRecord; usageEvent: ProviderUsageEventRecord } {
  const transcriptId = createId('batch_transcript');
  return {
    transcript: {
      id: transcriptId,
      batchId: options.batchId,
      provider: options.result.provider,
      model: options.result.model,
      text: options.result.text,
      createdAt: options.createdAt,
    },
    usageEvent: toProviderUsageEvent({
      sessionId: options.sessionId,
      operationKind: 'transcription',
      relatedEntityKind: 'batch_transcript',
      relatedEntityId: transcriptId,
      provider: options.result.provider,
      model: options.result.model,
      usage: options.result.usage,
      providerRequestId: options.result.providerRequestId,
      providerResponseJson: options.result.providerResponseJson,
      createdAt: options.createdAt,
    }),
  };
}

export function createSessionTranscriptionCoordinator(options: {
  sessionStore: TranscriptionStore;
  /**
   * Resolved per batch by the provider id recorded on the session, so a routing change never
   * retargets a recording that was already made against another provider.
   */
  resolveTranscriptionClient: (providerId: string) => TranscriptionClient | null;
  /**
   * Turns a batch's stored audio location into the bytes to upload. Host I/O: desktop reads the
   * WAV file. Called inside each attempt, so a read failure fails that attempt like any other
   * non-transient error.
   */
  readBatchAudio: (derivedAudioPath: string) => Promise<Uint8Array<ArrayBuffer>>;
  /** Records one event. Must never throw and never return a promise. */
  diagnostics?: { record: (event: TranscriptionCoordinatorEvent) => void };
  /**
   * Notified after a batch's transcript is stored, so a consumer can react to transcripts as they
   * arrive. Wired at the composition root rather than here, so transcription keeps no dependency on
   * whatever consumes it. Never allowed to fail a transcription task.
   */
  onBatchTranscribed?: (batch: TranscriptionBatchRecord) => void | Promise<void>;
}): SessionTranscriptionCoordinator {
  const diagnostics = options.diagnostics;
  const batchTasks = new Map<string, Promise<void>>();
  const sessionTasks = new Map<string, Set<Promise<void>>>();
  const sessionAbortControllers = new Map<string, Set<AbortController>>();
  const failedBatchIdsBySession = new Map<string, Set<string>>();

  const rememberTask = (batch: TranscriptionBatchRecord, task: Promise<void>) => {
    let tasks = sessionTasks.get(batch.sessionId);
    if (!tasks) {
      tasks = new Set();
      sessionTasks.set(batch.sessionId, tasks);
    }

    tasks.add(task);
    void task
      .finally(() => {
        tasks.delete(task);
        batchTasks.delete(batch.id);
      })
      .catch(() => {});
  };

  const rememberAbortController = (
    batch: TranscriptionBatchRecord,
    abortController: AbortController,
  ) => {
    let abortControllers = sessionAbortControllers.get(batch.sessionId);
    if (!abortControllers) {
      abortControllers = new Set();
      sessionAbortControllers.set(batch.sessionId, abortControllers);
    }

    abortControllers.add(abortController);
  };

  const forgetAbortController = (
    batch: TranscriptionBatchRecord,
    abortController: AbortController,
  ) => {
    const abortControllers = sessionAbortControllers.get(batch.sessionId);
    abortControllers?.delete(abortController);
    if (abortControllers?.size === 0) {
      sessionAbortControllers.delete(batch.sessionId);
    }
  };

  /**
   * A consumer's failure is its own problem: a transcribed batch is transcribed either way, and
   * letting a throw escape here would fail the batch after its transcript was already stored.
   */
  const notifyBatchTranscribed = async (batch: TranscriptionBatchRecord) => {
    if (!options.onBatchTranscribed) {
      return;
    }

    try {
      await options.onBatchTranscribed(batch);
    } catch (error) {
      console.error('Toph batch-transcribed notification failed.', error);
    }
  };

  const markFailed = async (batch: TranscriptionBatchRecord, attempts: number, error: unknown) => {
    const message = describeError(error);
    diagnostics?.record({
      kind: 'batch_failed',
      sessionId: batch.sessionId,
      batchId: batch.id,
      attempts,
      message,
    });
    await options.sessionStore.markBatchFailed({
      batchId: batch.id,
      attempts,
      errorMessage: message,
    });
    let failedBatchIds = failedBatchIdsBySession.get(batch.sessionId);
    if (!failedBatchIds) {
      failedBatchIds = new Set();
      failedBatchIdsBySession.set(batch.sessionId, failedBatchIds);
    }
    failedBatchIds.add(batch.id);
  };

  const transcribeBatch = async (
    batch: TranscriptionBatchRecord,
    abortController: AbortController,
    transcribeOptions: { resetAttempts?: boolean } = {},
  ) => {
    if (!batch.derivedAudioPath) {
      await markFailed(batch, batch.transcriptionAttempts, 'Batch audio was not generated.');
      return;
    }

    const session = await options.sessionStore.getSession(batch.sessionId);
    diagnostics?.record({
      kind: 'batch_session_loaded',
      sessionId: batch.sessionId,
      batchId: batch.id,
    });
    if (!session?.transcriptionProviderId || !session.transcriptionModel) {
      await markFailed(
        batch,
        batch.transcriptionAttempts,
        'Session transcription provider/model was not recorded.',
      );
      return;
    }
    const client = options.resolveTranscriptionClient(session.transcriptionProviderId);
    if (!client) {
      await markFailed(
        batch,
        batch.transcriptionAttempts,
        `Session transcription provider "${session.transcriptionProviderId}" is not available in this runtime.`,
      );
      return;
    }

    let attempt = transcribeOptions.resetAttempts ? 0 : batch.transcriptionAttempts;
    let lastError: unknown = null;
    while (attempt < maxAttempts) {
      attempt += 1;
      diagnostics?.record({
        kind: 'batch_attempt_started',
        sessionId: batch.sessionId,
        batchId: batch.id,
        attempt,
      });
      await options.sessionStore.markBatchTranscribing({
        batchId: batch.id,
        attempts: attempt,
        startedAt: Date.now(),
      });

      const attemptStartedAt = Date.now();
      try {
        const audio = await options.readBatchAudio(batch.derivedAudioPath);
        const result = await client.transcribeBatch({
          batchId: batch.id,
          audio,
          durationMs: batch.derivedAudioDurationMs,
          model: session.transcriptionModel,
          signal: abortController.signal,
        });
        const createdAt = Date.now();
        diagnostics?.record({
          kind: 'batch_attempt_succeeded',
          sessionId: batch.sessionId,
          batchId: batch.id,
          attempt,
          providerDurationMs: createdAt - attemptStartedAt,
        });
        await options.sessionStore.createBatchTranscript(
          toTranscriptRows({ sessionId: batch.sessionId, batchId: batch.id, result, createdAt }),
        );
        await options.sessionStore.markBatchTranscribed({
          batchId: batch.id,
          transcribedAt: createdAt,
        });
        await notifyBatchTranscribed(batch);
        return;
      } catch (error) {
        lastError = error;
        const transient = isTransientTranscriptionProviderError(error);
        diagnostics?.record({
          kind: 'batch_attempt_failed',
          sessionId: batch.sessionId,
          batchId: batch.id,
          attempt,
          transient,
          message: describeError(error),
        });
        if (!transient || attempt >= maxAttempts) {
          break;
        }

        await sleep(retryDelayMs * attempt, abortController.signal);
      }
    }

    await markFailed(batch, attempt, lastError);
  };

  return {
    async onBatchReady(batchId, batchOptions) {
      diagnostics?.record({
        kind: 'batch_received',
        batchId,
        resetAttempts: batchOptions?.resetAttempts === true,
      });
      if (batchTasks.has(batchId)) {
        diagnostics?.record({ kind: 'batch_skipped', batchId, reason: 'already_tracked' });
        return;
      }

      const batch = await options.sessionStore.getTranscriptionBatch(batchId);
      if (!batch || batch.status === 'transcribed') {
        diagnostics?.record({
          kind: 'batch_skipped',
          batchId,
          reason: batch ? 'already_transcribed' : 'missing_row',
        });
        return;
      }

      const abortController = new AbortController();
      rememberAbortController(batch, abortController);
      const task = (async () => {
        diagnostics?.record({
          kind: 'batch_task_created',
          sessionId: batch.sessionId,
          batchId: batch.id,
        });
        try {
          await transcribeBatch(batch, abortController, batchOptions);
        } finally {
          diagnostics?.record({
            kind: 'batch_task_settled',
            sessionId: batch.sessionId,
            batchId: batch.id,
          });
          forgetAbortController(batch, abortController);
        }
      })();
      task.catch((error: unknown) => {
        if (abortController.signal.aborted && isTranscriptionAbortError(error)) {
          return;
        }

        console.error('Toph batch transcription task failed unexpectedly.', error);
      });

      batchTasks.set(batchId, task);
      rememberTask(batch, task);
    },

    async cancelSession(sessionId) {
      for (const abortController of sessionAbortControllers.get(sessionId) ?? []) {
        abortController.abort();
      }
      await this.waitForSession(sessionId);
    },

    async waitForSession(sessionId) {
      let tasks = sessionTasks.get(sessionId);
      while (tasks && tasks.size > 0) {
        await Promise.allSettled(Array.from(tasks));
        tasks = sessionTasks.get(sessionId);
      }

      const batches = await options.sessionStore.listTranscriptionBatchesForSession(sessionId);
      const failedBatchCount = batches.filter((batch) => batch.status === 'failed').length;
      const incompleteBatchCount = batches.filter(
        (batch) => batch.status !== 'transcribed' && batch.status !== 'failed',
      ).length;

      return { failedOrIncompleteBatchCount: failedBatchCount + incompleteBatchCount };
    },

    async dispose() {
      for (const abortControllers of sessionAbortControllers.values()) {
        for (const abortController of abortControllers) {
          abortController.abort();
        }
      }

      await Promise.allSettled(Array.from(batchTasks.values()));
    },
  };
}
