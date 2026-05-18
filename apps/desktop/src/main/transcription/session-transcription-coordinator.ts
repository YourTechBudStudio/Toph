import { randomUUID } from 'node:crypto';

import type { BatchTranscript, ProviderUsageEvent, TranscriptionBatch } from '../db/schema';
import type { RecordingSessionStore } from '../stores/session-store';
import {
  isTransientTranscriptionProviderError,
  type TranscriptionProvider,
  type TranscriptionProviderResult,
} from './transcription-provider';

export interface SessionTranscriptionCoordinator {
  onBatchReady: (batchId: string) => Promise<void>;
  transcribeAudio: (input: {
    sessionId: string;
    audioPath: string;
    durationMs: number;
    label: string;
    signal?: AbortSignal;
  }) => Promise<TranscriptionProviderResult>;
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

function createUsageEventId() {
  return `provider_usage_${Date.now()}_${randomUUID()}`;
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown transcription error.';
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
  result: TranscriptionProviderResult;
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
    usageEvent: {
      id: createUsageEventId(),
      sessionId: options.sessionId,
      operationKind: 'transcription',
      relatedEntityKind: 'batch_transcript',
      relatedEntityId: transcriptId,
      provider: options.result.provider,
      model: options.result.model,
      billingMode: options.result.usage.billingMode,
      audioDurationMs: options.result.usage.audioDurationMs,
      billableDurationMs: options.result.usage.billableDurationMs,
      inputTokens: options.result.usage.inputTokens,
      cachedInputTokens: options.result.usage.cachedInputTokens,
      outputTokens: options.result.usage.outputTokens,
      estimatedCostUsdMicros: options.result.usage.estimatedCostUsdMicros,
      costSource: options.result.usage.costSource,
      pricingCatalogProviderId: options.result.usage.pricingCatalogProviderId,
      pricingCatalogModelId: options.result.usage.pricingCatalogModelId,
      providerRequestId: options.result.providerRequestId,
      providerResponseJson: JSON.stringify(options.result.providerResponseJson) ?? null,
      createdAt: options.createdAt,
    },
  };
}

export function createSessionTranscriptionCoordinator(options: {
  sessionStore: Pick<
    RecordingSessionStore,
    | 'getTranscriptionBatch'
    | 'listTranscriptionBatchesForSession'
    | 'markBatchTranscribing'
    | 'markBatchTranscribed'
    | 'markBatchFailed'
    | 'createBatchTranscript'
  >;
  provider: TranscriptionProvider;
}): SessionTranscriptionCoordinator {
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
    task.finally(() => {
      tasks.delete(task);
      batchTasks.delete(batch.id);
    });
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

  const markFailed = async (batch: TranscriptionBatch, attempts: number, error: unknown) => {
    const message = describeError(error);
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

  const transcribeAudioWithRetries = async (input: {
    batchId: string;
    audioPath: string;
    durationMs: number;
    initialAttempt?: number;
    signal?: AbortSignal;
  }) => {
    let attempt = input.initialAttempt ?? 0;
    let lastError: unknown = null;
    while (attempt < maxAttempts) {
      attempt += 1;

      try {
        return await options.provider.transcribeBatch({
          batchId: input.batchId,
          audioPath: input.audioPath,
          durationMs: input.durationMs,
          signal: input.signal,
        });
      } catch (error) {
        lastError = error;
        if (!isTransientTranscriptionProviderError(error) || attempt >= maxAttempts) {
          break;
        }

        await sleep(retryDelayMs * attempt, input.signal);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(describeError(lastError));
  };

  const transcribeBatch = async (batch: TranscriptionBatch, abortController: AbortController) => {
    if (!batch.derivedAudioPath) {
      await markFailed(batch, batch.transcriptionAttempts, 'Batch audio was not generated.');
      return;
    }

    let attempt = batch.transcriptionAttempts;
    let lastError: unknown = null;
    while (attempt < maxAttempts) {
      attempt += 1;
      await options.sessionStore.markBatchTranscribing({
        batchId: batch.id,
        attempts: attempt,
        startedAt: Date.now(),
      });

      try {
        const result = await options.provider.transcribeBatch({
          batchId: batch.id,
          audioPath: batch.derivedAudioPath,
          durationMs: batch.derivedAudioDurationMs,
          signal: abortController.signal,
        });
        const createdAt = Date.now();
        await options.sessionStore.createBatchTranscript(
          toTranscriptRows({ sessionId: batch.sessionId, batchId: batch.id, result, createdAt }),
        );
        await options.sessionStore.markBatchTranscribed({
          batchId: batch.id,
          transcribedAt: createdAt,
        });
        return;
      } catch (error) {
        lastError = error;
        if (!isTransientTranscriptionProviderError(error) || attempt >= maxAttempts) {
          break;
        }

        await sleep(retryDelayMs * attempt, abortController.signal);
      }
    }

    await markFailed(batch, attempt, lastError);
  };

  return {
    async onBatchReady(batchId) {
      if (batchTasks.has(batchId)) {
        return;
      }

      const batch = await options.sessionStore.getTranscriptionBatch(batchId);
      if (!batch || batch.status === 'transcribed') {
        return;
      }

      const abortController = new AbortController();
      rememberAbortController(batch, abortController);
      const task = (async () => {
        try {
          await transcribeBatch(batch, abortController);
        } finally {
          forgetAbortController(batch, abortController);
        }
      })();
      task.catch((error: unknown) => {
        console.error('Toph batch transcription task failed unexpectedly.', error);
      });

      batchTasks.set(batchId, task);
      rememberTask(batch, task);
    },

    async transcribeAudio(input) {
      return transcribeAudioWithRetries({
        batchId: `${input.sessionId}:${input.label}`,
        audioPath: input.audioPath,
        durationMs: input.durationMs,
        signal: input.signal,
      });
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
