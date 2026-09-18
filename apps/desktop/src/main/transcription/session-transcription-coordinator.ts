import { randomUUID } from 'node:crypto';

import type { BatchTranscript, ProviderUsageEvent, TranscriptionBatch } from '../db/schema';
import type { TranscriptionDiagnostics } from '../diagnostics/transcription-diagnostics';
import { toProviderUsageEvent } from '../provider-usage';
import {
  isTransientTranscriptionProviderError,
  type TranscriptionClient,
  type TranscriptionClientResult,
} from '../providers/provider-definition';
import type { RecordingSessionStore } from '../stores/session-store';

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

function createTranscriptId() {
  return `batch_transcript_${Date.now()}_${randomUUID()}`;
}

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
}): { transcript: BatchTranscript; usageEvent: ProviderUsageEvent } {
  const transcriptId = createTranscriptId();
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
  sessionStore: Pick<
    RecordingSessionStore,
    | 'getSession'
    | 'getTranscriptionBatch'
    | 'listTranscriptionBatchesForSession'
    | 'markBatchTranscribing'
    | 'markBatchTranscribed'
    | 'markBatchFailed'
    | 'createBatchTranscript'
  >;
  /**
   * Resolved per batch by the provider id recorded on the session, so a routing change never
   * retargets a recording that was already made against another provider.
   */
  resolveTranscriptionClient: (providerId: string) => TranscriptionClient | null;
  diagnostics?: TranscriptionDiagnostics;
  /**
   * Notified after a batch's transcript is stored, so a consumer can react to transcripts as they
   * arrive. Wired at the composition root rather than here, so transcription keeps no dependency on
   * whatever consumes it. Never allowed to fail a transcription task.
   */
  onBatchTranscribed?: (batch: TranscriptionBatch) => void | Promise<void>;
}): SessionTranscriptionCoordinator {
  const diagnostics = options.diagnostics;
  const batchTasks = new Map<string, Promise<void>>();
  const sessionTasks = new Map<string, Set<Promise<void>>>();
  const sessionAbortControllers = new Map<string, Set<AbortController>>();
  const failedBatchIdsBySession = new Map<string, Set<string>>();

  const rememberTask = (batch: TranscriptionBatch, task: Promise<void>) => {
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

  const rememberAbortController = (batch: TranscriptionBatch, abortController: AbortController) => {
    let abortControllers = sessionAbortControllers.get(batch.sessionId);
    if (!abortControllers) {
      abortControllers = new Set();
      sessionAbortControllers.set(batch.sessionId, abortControllers);
    }

    abortControllers.add(abortController);
  };

  const forgetAbortController = (batch: TranscriptionBatch, abortController: AbortController) => {
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
  const notifyBatchTranscribed = async (batch: TranscriptionBatch) => {
    if (!options.onBatchTranscribed) {
      return;
    }

    try {
      await options.onBatchTranscribed(batch);
    } catch (error) {
      console.error('Toph batch-transcribed notification failed.', error);
    }
  };

  const markFailed = async (batch: TranscriptionBatch, attempts: number, error: unknown) => {
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
    batch: TranscriptionBatch,
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
        const result = await client.transcribeBatch({
          batchId: batch.id,
          audioPath: batch.derivedAudioPath,
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
