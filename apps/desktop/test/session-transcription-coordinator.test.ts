import assert from 'node:assert/strict';
import test from 'node:test';

import type { RecordingSession, TranscriptionBatch } from '../src/main/db/schema.ts';
import type { TranscriptionDiagnosticEvent } from '../src/main/diagnostics/transcription-diagnostics.ts';
import { registerTsExtensionResolver } from './helpers/ts-extension-resolver.ts';

registerTsExtensionResolver();

const { createSessionTranscriptionCoordinator } =
  await import('../src/main/transcription/session-transcription-coordinator.ts');

function createSession(options: {
  transcriptionProviderId: string;
  transcriptionModel: string;
}): RecordingSession {
  const now = Date.now();
  return {
    id: 'session-1',
    createdAt: now,
    startedAt: now,
    endedAt: null,
    durationMs: null,
    rawAudioPath: '/tmp/session.wav',
    transcriptionProviderId: options.transcriptionProviderId,
    transcriptionModel: options.transcriptionModel,
    status: 'segmented',
    selectedOutputId: null,
    errorMessage: null,
  };
}

function createBatch(): TranscriptionBatch {
  return {
    id: 'batch-1',
    sessionId: 'session-1',
    sequence: 0,
    status: 'planned' as const,
    sourceDurationMs: 1_000,
    derivedAudioDurationMs: 1_000,
    createdLive: false,
    derivedAudioPath: '/tmp/batch.wav',
    createdAt: Date.now(),
    transcriptionAttempts: 0,
    transcriptionStartedAt: null,
    transcribedAt: null,
    errorMessage: null,
  };
}

test('transcribes with the session snapshot model instead of live provider settings', async () => {
  const batch = createBatch();
  let receivedModel: string | null = null;
  const store = {
    getSession: async () =>
      createSession({
        transcriptionProviderId: 'openai-sub',
        transcriptionModel: 'snapshot-model',
      }),
    getTranscriptionBatch: async () => batch,
    listTranscriptionBatchesForSession: async () => [{ ...batch, status: 'transcribed' as const }],
    markBatchTranscribing: async ({ attempts }: { attempts: number }) => {
      batch.status = 'transcribing';
      batch.transcriptionAttempts = attempts;
    },
    markBatchTranscribed: async () => {
      batch.status = 'transcribed';
    },
    markBatchFailed: async (input: { attempts: number; errorMessage: string }) => {
      batch.status = 'failed';
      batch.transcriptionAttempts = input.attempts;
      batch.errorMessage = input.errorMessage;
    },
    createBatchTranscript: async () => {},
  };
  const coordinator = createSessionTranscriptionCoordinator({
    sessionStore: store,
    resolveTranscriptionClient: (providerId) => ({
      id: providerId,
      transcribeBatch: async (input) => {
        receivedModel = input.model;
        return {
          text: 'hello',
          provider: 'openai-sub',
          model: input.model,
          usage: {
            billingMode: 'subscription',
            audioDurationMs: input.durationMs,
            billableDurationMs: input.durationMs,
            inputTokens: null,
            cachedInputTokens: null,
            outputTokens: null,
            estimatedCostUsdMicros: 0,
            costSource: 'none',
            pricingCatalogProviderId: null,
            pricingCatalogModelId: null,
          },
          providerRequestId: null,
          providerResponseJson: null,
        };
      },
    }),
  });

  await coordinator.onBatchReady(batch.id);
  await coordinator.waitForSession(batch.sessionId);

  assert.equal(receivedModel, 'snapshot-model');
  assert.equal(batch.status, 'transcribed');
});

test('fails the batch when the session snapshot provider is not registered in this runtime', async () => {
  const batch = createBatch();
  let providerCalled = false;
  const coordinator = createSessionTranscriptionCoordinator({
    sessionStore: {
      getSession: async () =>
        createSession({
          transcriptionProviderId: 'other-provider',
          transcriptionModel: 'snapshot-model',
        }),
      getTranscriptionBatch: async () => batch,
      listTranscriptionBatchesForSession: async () => [batch],
      markBatchTranscribing: async () => {},
      markBatchTranscribed: async () => {
        batch.status = 'transcribed';
      },
      markBatchFailed: async (input: { attempts: number; errorMessage: string }) => {
        batch.status = 'failed';
        batch.transcriptionAttempts = input.attempts;
        batch.errorMessage = input.errorMessage;
      },
      createBatchTranscript: async () => {},
    },
    resolveTranscriptionClient: (providerId) =>
      providerId === 'openai-sub'
        ? {
            id: providerId,
            transcribeBatch: async () => {
              providerCalled = true;
              throw new Error('should not transcribe');
            },
          }
        : null,
  });

  await coordinator.onBatchReady(batch.id);
  const outcome = await coordinator.waitForSession(batch.sessionId);

  assert.equal(providerCalled, false);
  assert.equal(batch.status, 'failed');
  assert.equal(outcome.failedOrIncompleteBatchCount, 1);
  assert.match(batch.errorMessage ?? '', /other-provider/);
});

// Diagnostics harness. These assertions are the phase-02 discriminator: for any batch that was
// handed to the coordinator, the recorded trail must say whether a task was ever created, whether
// that task ever began executing, and whether an attempt was ever made. See
// scratch/plans/incremental-polish/phase-02-live-transcription-lag.md.

function createRecordingDiagnostics() {
  const events: TranscriptionDiagnosticEvent[] = [];
  return {
    events,
    kinds: () => events.map((event) => event.kind),
    diagnostics: {
      record: (event: TranscriptionDiagnosticEvent) => {
        events.push(event);
      },
      flush: async () => {},
    },
  };
}

function createSuccessClientResolver() {
  const client = createSuccessClient();
  return () => client;
}

function createSuccessClient() {
  return {
    id: 'openai-sub',
    transcribeBatch: async (input: { model: string; durationMs: number }) => ({
      text: 'hello',
      provider: 'openai-sub',
      model: input.model,
      usage: {
        billingMode: 'subscription' as const,
        audioDurationMs: input.durationMs,
        billableDurationMs: input.durationMs,
        inputTokens: null,
        cachedInputTokens: null,
        outputTokens: null,
        estimatedCostUsdMicros: 0,
        costSource: 'none' as const,
        pricingCatalogProviderId: null,
        pricingCatalogModelId: null,
      },
      providerRequestId: null,
      providerResponseJson: null,
    }),
  };
}

function createStore(batch: TranscriptionBatch) {
  return {
    getSession: async () =>
      createSession({
        transcriptionProviderId: 'openai-sub',
        transcriptionModel: 'snapshot-model',
      }),
    getTranscriptionBatch: async () => batch,
    listTranscriptionBatchesForSession: async () => [batch],
    markBatchTranscribing: async ({ attempts }: { attempts: number }) => {
      batch.status = 'transcribing';
      batch.transcriptionAttempts = attempts;
    },
    markBatchTranscribed: async () => {
      batch.status = 'transcribed';
    },
    markBatchFailed: async (input: { attempts: number; errorMessage: string }) => {
      batch.status = 'failed';
      batch.transcriptionAttempts = input.attempts;
      batch.errorMessage = input.errorMessage;
    },
    createBatchTranscript: async () => {},
  };
}

test('a transcribed batch records the full task and attempt trail', async () => {
  const batch = createBatch();
  const recorder = createRecordingDiagnostics();
  const coordinator = createSessionTranscriptionCoordinator({
    sessionStore: createStore(batch),
    resolveTranscriptionClient: createSuccessClientResolver(),
    diagnostics: recorder.diagnostics,
  });

  await coordinator.onBatchReady(batch.id);
  await coordinator.waitForSession(batch.sessionId);

  assert.deepEqual(recorder.kinds(), [
    'batch_received',
    'batch_task_created',
    'batch_session_loaded',
    'batch_attempt_started',
    'batch_attempt_succeeded',
    'batch_task_settled',
  ]);
});

test('a batch that is handed over but never starts a task records why it was skipped', async () => {
  const batch = { ...createBatch(), status: 'transcribed' as const };
  const recorder = createRecordingDiagnostics();
  const coordinator = createSessionTranscriptionCoordinator({
    sessionStore: createStore(batch),
    resolveTranscriptionClient: createSuccessClientResolver(),
    diagnostics: recorder.diagnostics,
  });

  await coordinator.onBatchReady(batch.id);
  await coordinator.waitForSession(batch.sessionId);

  assert.deepEqual(recorder.kinds(), ['batch_received', 'batch_skipped']);
  assert.equal(
    recorder.events.find((event) => event.kind === 'batch_skipped')?.reason,
    'already_transcribed',
  );
  assert.equal(
    recorder.kinds().includes('batch_task_created'),
    false,
    'a skipped batch must never look like one whose task ran',
  );
});

test('a transiently failing batch records every attempt and the final failure', async () => {
  const batch = createBatch();
  const recorder = createRecordingDiagnostics();
  const { TransientTranscriptionProviderError } =
    await import('../src/main/providers/provider-definition.ts');
  const coordinator = createSessionTranscriptionCoordinator({
    sessionStore: createStore(batch),
    resolveTranscriptionClient: () => ({
      id: 'openai-sub',
      transcribeBatch: async () => {
        throw new TransientTranscriptionProviderError('upstream said 503');
      },
    }),
    diagnostics: recorder.diagnostics,
  });

  await coordinator.onBatchReady(batch.id);
  await coordinator.waitForSession(batch.sessionId);

  assert.deepEqual(recorder.kinds(), [
    'batch_received',
    'batch_task_created',
    'batch_session_loaded',
    'batch_attempt_started',
    'batch_attempt_failed',
    'batch_attempt_started',
    'batch_attempt_failed',
    'batch_attempt_started',
    'batch_attempt_failed',
    'batch_failed',
    'batch_task_settled',
  ]);
  assert.equal(
    recorder.events.every((event) => !('transient' in event) || event.transient === true),
    true,
  );
  assert.equal(batch.status, 'failed');
});

test('a slow session read is attributable to the gap before batch_session_loaded', async () => {
  const batch = createBatch();
  const timeline: Array<{ kind: string; at: number }> = [];
  const store = createStore(batch);
  const coordinator = createSessionTranscriptionCoordinator({
    sessionStore: {
      ...store,
      getSession: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return store.getSession();
      },
    },
    resolveTranscriptionClient: createSuccessClientResolver(),
    diagnostics: {
      record: (event: TranscriptionDiagnosticEvent) => {
        timeline.push({ kind: event.kind, at: Date.now() });
      },
      flush: async () => {},
    },
  });

  await coordinator.onBatchReady(batch.id);
  await coordinator.waitForSession(batch.sessionId);

  const at = (kind: string) => timeline.find((entry) => entry.kind === kind)?.at ?? 0;
  // The created-to-loaded gap absorbs the delay; loaded-to-attempt stays synchronous. This is what
  // lets a reproduction say where the stall sits instead of inferring it from an absence.
  assert.ok(at('batch_session_loaded') - at('batch_task_created') >= 45);
  assert.ok(at('batch_attempt_started') - at('batch_session_loaded') < 45);
});

test('notifies a consumer after a batch is marked transcribed', async () => {
  const batch = createBatch();
  const store = createStore(batch);
  const notified: Array<{ batchId: string; status: string }> = [];
  const coordinator = createSessionTranscriptionCoordinator({
    sessionStore: store,
    resolveTranscriptionClient: createSuccessClientResolver(),
    onBatchTranscribed: (notifiedBatch) => {
      notified.push({ batchId: notifiedBatch.id, status: batch.status });
    },
  });

  await coordinator.onBatchReady(batch.id);
  await coordinator.waitForSession(batch.sessionId);

  assert.deepEqual(notified, [{ batchId: batch.id, status: 'transcribed' }]);
});

test('a failing consumer cannot fail the transcription task', async () => {
  const batch = createBatch();
  const store = createStore(batch);
  const coordinator = createSessionTranscriptionCoordinator({
    sessionStore: store,
    resolveTranscriptionClient: createSuccessClientResolver(),
    onBatchTranscribed: async () => {
      throw new Error('The polish side exploded.');
    },
  });

  await coordinator.onBatchReady(batch.id);
  const outcome = await coordinator.waitForSession(batch.sessionId);

  assert.equal(batch.status, 'transcribed');
  assert.equal(outcome.failedOrIncompleteBatchCount, 0);
});

test('a batch that fails notifies no consumer', async () => {
  const batch = createBatch();
  const store = createStore(batch);
  let notifications = 0;
  const coordinator = createSessionTranscriptionCoordinator({
    sessionStore: {
      ...store,
      getSession: async () => null,
    },
    resolveTranscriptionClient: createSuccessClientResolver(),
    onBatchTranscribed: () => {
      notifications += 1;
    },
  });

  await coordinator.onBatchReady(batch.id);
  await coordinator.waitForSession(batch.sessionId);

  assert.equal(batch.status, 'failed');
  assert.equal(notifications, 0);
});
