import {
  assembleRawTranscriptText,
  createOpenAiTranscriptionClient,
  createSessionTranscriptionCoordinator,
} from '@toph/dictation-core';
import type {
  OrderedBatchTranscript,
  PlannedTranscriptionBatch,
  TranscriptionBatchRecord,
  TranscriptionCoordinatorEvent,
  TranscriptionStore,
} from '@toph/dictation-core';

import type { ProviderConfig } from '../../provider';
import { noCost } from './no-cost';

/** How a dictation ended. */
export type DictationOutcome =
  | { kind: 'transcript'; text: string }
  /** Nothing was planned, or every batch came back "". */
  | { kind: 'no_speech' }
  | { kind: 'failed'; message: string };

/** One dictation's uploads, through the shared core's coordinator, OpenAI client and retry policy. */
export interface Transcription {
  /** Registers the batch and schedules its upload. Resolves once scheduled, not when uploaded. */
  addBatch(batch: PlannedTranscriptionBatch, audioUri: string): Promise<void>;
  /** Waits for every scheduled upload, releases the coordinator, and turns the result into an outcome. */
  finish(): Promise<DictationOutcome>;
  /** Aborts in-flight uploads, waits for them, and releases the coordinator. */
  cancel(): Promise<void>;
  /**
   * Transcribed batches in spoken order, as desktop's batch/transcript join returns them. Stays
   * readable after `finish()` and `cancel()`.
   */
  orderedTranscripts(): OrderedBatchTranscript[];
}

interface BatchEntry {
  record: TranscriptionBatchRecord;
  sequence: number;
  text: string | null;
  error: string | null;
}

/**
 * Exactly one of `finish` and `cancel` is called per transcription.
 *
 * The coordinator is the core's, unchanged; it gets an in-memory store that lives as long as this
 * dictation. Batches stay in memory: history needs only the session's outputs.
 */
export function createTranscription(options: {
  sessionId: string;
  config: ProviderConfig;
  readBatchAudio: (uri: string) => Promise<Uint8Array<ArrayBuffer>>;
  log: (message: string) => void;
  /** Called after each batch's transcript is stored. Core logs and swallows its failures. */
  onBatchTranscribed?: ((batch: { sessionId: string }) => Promise<void>) | undefined;
}): Transcription {
  const { sessionId, config, log } = options;
  const batches = new Map<string, BatchEntry>();

  const entry = (batchId: string) => {
    const found = batches.get(batchId);
    if (found === undefined) {
      throw new Error(`Unknown transcription batch ${batchId}.`);
    }
    return found;
  };

  const sessionStore: TranscriptionStore = {
    // The model is fixed for the session, as desktop records it at start.
    getSession: async (id) =>
      id === sessionId
        ? { transcriptionProviderId: 'openai', transcriptionModel: config.transcriptionModel }
        : null,
    // A copy, as a database read would return, so the coordinator never sees later writes.
    getTranscriptionBatch: async (batchId) => {
      const found = batches.get(batchId);
      return found === undefined ? null : { ...found.record };
    },
    listTranscriptionBatchesForSession: async (id) =>
      [...batches.values()]
        .filter(({ record }) => record.sessionId === id)
        .map(({ record }) => ({ status: record.status })),
    markBatchTranscribing: async ({ batchId, attempts }) => {
      const { record } = entry(batchId);
      record.status = 'transcribing';
      record.transcriptionAttempts = attempts;
    },
    markBatchTranscribed: async ({ batchId }) => {
      entry(batchId).record.status = 'transcribed';
    },
    markBatchFailed: async ({ batchId, attempts, errorMessage }) => {
      const found = entry(batchId);
      found.record.status = 'failed';
      found.record.transcriptionAttempts = attempts;
      found.error = errorMessage;
    },
    // The usage event is dropped: no history or cost tracking in this story.
    createBatchTranscript: async ({ transcript }) => {
      entry(transcript.batchId).text = transcript.text;
    },
  };

  const batchNumber = (batchId: string) => {
    const found = batches.get(batchId);
    return found === undefined ? '?' : String(found.sequence + 1);
  };

  // The "visible in logs" lines. Must never throw.
  const record = (event: TranscriptionCoordinatorEvent) => {
    try {
      switch (event.kind) {
        case 'batch_attempt_started':
          log(`batch ${batchNumber(event.batchId)} upload attempt ${event.attempt} started`);
          break;
        case 'batch_attempt_succeeded':
          log(
            `batch ${batchNumber(event.batchId)} upload attempt ${event.attempt} succeeded in ${event.providerDurationMs}ms`,
          );
          break;
        case 'batch_attempt_failed':
          log(
            `batch ${batchNumber(event.batchId)} upload attempt ${event.attempt} failed (${event.transient ? 'transient' : 'permanent'}): ${event.message}`,
          );
          break;
        case 'batch_failed':
          log(`batch ${batchNumber(event.batchId)} failed after ${event.attempts} attempts`);
          break;
        default:
          break;
      }
    } catch {
      // Logging must never fail a transcription.
    }
  };

  const client = createOpenAiTranscriptionClient({
    credentials: config.credentials,
    billingMode: 'metered',
    pricing: noCost,
  });
  const coordinator = createSessionTranscriptionCoordinator({
    sessionStore,
    resolveTranscriptionClient: (providerId) => (providerId === client.id ? client : null),
    readBatchAudio: options.readBatchAudio,
    onBatchTranscribed: async (batch) => options.onBatchTranscribed?.(batch),
    diagnostics: { record },
  });

  const orderedTranscripts = (): OrderedBatchTranscript[] =>
    [...batches.values()]
      .filter((found): found is BatchEntry & { text: string } => found.text !== null)
      .sort((a, b) => a.sequence - b.sequence)
      .map(({ record: { id }, sequence, text }) => ({ batchId: id, sequence, text }));

  const toOutcome = (failedOrIncompleteBatchCount: number): DictationOutcome => {
    const ordered = [...batches.values()].sort((a, b) => a.sequence - b.sequence);
    if (ordered.length === 0) {
      return { kind: 'no_speech' };
    }
    if (failedOrIncompleteBatchCount > 0) {
      // As on desktop, one failed batch fails the whole dictation; partial text is not shown.
      const failed = ordered.find(({ error }) => error !== null);
      return { kind: 'failed', message: failed?.error ?? 'Transcription did not finish.' };
    }
    // The same texts the raw output is assembled from, so a transcript here always has a raw output.
    const text = assembleRawTranscriptText(
      orderedTranscripts().map(({ text: batchText }) => batchText),
    );
    return text === '' ? { kind: 'no_speech' } : { kind: 'transcript', text };
  };

  return {
    async addBatch(batch, audioUri) {
      batches.set(batch.id, {
        record: {
          id: batch.id,
          sessionId,
          status: 'planned',
          transcriptionAttempts: 0,
          derivedAudioPath: audioUri,
          derivedAudioDurationMs: batch.derivedAudioDurationMs,
        },
        sequence: batch.sequence,
        text: null,
        error: null,
      });
      // Required: the coordinator registers the upload only after its own store read. Without this
      // await, `finish()` could run first and count the batch as incomplete. Desktop awaits it too.
      await coordinator.onBatchReady(batch.id);
    },

    async finish() {
      const { failedOrIncompleteBatchCount } = await coordinator.waitForSession(sessionId);
      await coordinator.dispose();
      return toOutcome(failedOrIncompleteBatchCount);
    },

    async cancel() {
      await coordinator.cancelSession(sessionId);
      await coordinator.dispose();
    },

    orderedTranscripts,
  };
}
