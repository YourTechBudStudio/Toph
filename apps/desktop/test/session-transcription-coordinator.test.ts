import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

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
    provider: {
      id: 'openai-sub',
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
    },
  });

  await coordinator.onBatchReady(batch.id);
  await coordinator.waitForSession(batch.sessionId);

  assert.equal(receivedModel, 'snapshot-model');
  assert.equal(batch.status, 'transcribed');
});

test('fails the batch when the session snapshot provider does not match the runtime provider', async () => {
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
    provider: {
      id: 'openai-sub',
      transcribeBatch: async () => {
        providerCalled = true;
        throw new Error('should not transcribe');
      },
    },
  });

  await coordinator.onBatchReady(batch.id);
  const outcome = await coordinator.waitForSession(batch.sessionId);

  assert.equal(providerCalled, false);
  assert.equal(batch.status, 'failed');
  assert.equal(outcome.failedOrIncompleteBatchCount, 1);
  assert.match(batch.errorMessage ?? '', /other-provider/);
});
