import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import type { ProviderUsageEvent, SessionOutput } from '../../src/main/db/schema.ts';
import type { TophDataPaths } from '../../src/main/paths.ts';
import type { RecordingSessionStore } from '../../src/main/stores/session-store.ts';
import { registerTsExtensionResolver } from '../helpers/ts-extension-resolver.ts';

registerTsExtensionResolver();

const { createRecordingSessionStore } = await import('../../src/main/stores/session-store.ts');

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

async function createStore() {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'toph-store-test-'));
  const paths = {
    dataDirectory,
    authPath: join(dataDirectory, 'auth.json'),
    settingsPath: join(dataDirectory, 'settings.json'),
    databasePath: join(dataDirectory, 'toph.db'),
    pricingDirectory: join(dataDirectory, 'pricing'),
    modelsDevCachePath: join(dataDirectory, 'pricing', 'models-dev.json'),
    recordingsDirectory: join(dataDirectory, 'recordings'),
    diagnosticsDirectory: join(dataDirectory, 'diagnostics'),
    transcriptionDiagnosticsPath: join(dataDirectory, 'diagnostics', 'transcription.jsonl'),
  } satisfies TophDataPaths;

  const store = await createRecordingSessionStore({ paths, migrationsFolder });
  return {
    store,
    async dispose() {
      store.close();
      await rm(dataDirectory, { recursive: true, force: true });
    },
  };
}

function usageEvent(
  input: Pick<
    ProviderUsageEvent,
    'id' | 'sessionId' | 'operationKind' | 'relatedEntityKind' | 'relatedEntityId'
  > & { estimatedCostUsdMicros: number },
): ProviderUsageEvent {
  return {
    provider: 'test',
    model: 'test-model',
    billingMode: 'metered',
    audioDurationMs: null,
    billableDurationMs: null,
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    costSource: 'provider_reported',
    pricingCatalogProviderId: null,
    pricingCatalogModelId: null,
    providerRequestId: null,
    providerResponseJson: null,
    createdAt: Date.now(),
    ...input,
  };
}

function polishedOutput(sessionId: string, id: string): SessionOutput {
  return {
    id,
    sessionId,
    kind: 'polished',
    text: 'One two three four five.',
    sourceOutputId: null,
    provider: 'test',
    model: 'test-model',
    rulePresetId: 'engineer',
    rulePresetHash: 'rule-hash',
    createdAt: Date.now(),
  };
}

test('dashboard stats count polish chunk cost alongside the output and transcription cost', async () => {
  const { store, dispose } = await createStore();
  try {
    const session = await store.createRecordingSession({
      transcriptionProviderId: 'openai-sub',
      transcriptionModel: 'chatgpt-backend-transcribe',
    });
    const output = polishedOutput(session.id, 'output-1');
    await store.createSessionOutput({
      output,
      usageEvent: usageEvent({
        id: 'usage-output',
        sessionId: session.id,
        operationKind: 'inference',
        relatedEntityKind: 'session_output',
        relatedEntityId: output.id,
        estimatedCostUsdMicros: 100,
      }),
    });
    await store.selectSessionOutput({ sessionId: session.id, outputId: output.id });
    // Distinct amounts, so a positional-parameter mistake in the usage query cannot pass by summing
    // to the same total.
    await store.createProviderUsageEvent(
      usageEvent({
        id: 'usage-chunk-1',
        sessionId: session.id,
        operationKind: 'inference',
        relatedEntityKind: 'polish_chunk',
        relatedEntityId: session.id,
        estimatedCostUsdMicros: 20,
      }),
    );
    await store.createProviderUsageEvent(
      usageEvent({
        id: 'usage-chunk-2',
        sessionId: session.id,
        operationKind: 'inference',
        relatedEntityKind: 'polish_chunk',
        relatedEntityId: session.id,
        estimatedCostUsdMicros: 7,
      }),
    );
    await store.createProviderUsageEvent(
      usageEvent({
        id: 'usage-transcription',
        sessionId: session.id,
        operationKind: 'transcription',
        relatedEntityKind: 'batch_transcript',
        relatedEntityId: 'transcript-1',
        estimatedCostUsdMicros: 3,
      }),
    );
    // Another session's chunk cost must not leak into this window's total.
    const otherSession = await store.createRecordingSession({
      transcriptionProviderId: 'openai-sub',
      transcriptionModel: 'chatgpt-backend-transcribe',
    });
    await store.createProviderUsageEvent(
      usageEvent({
        id: 'usage-other-chunk',
        sessionId: otherSession.id,
        operationKind: 'inference',
        relatedEntityKind: 'polish_chunk',
        relatedEntityId: otherSession.id,
        estimatedCostUsdMicros: 5_000,
      }),
    );

    const stats = await store.getDashboardStats({
      now: Date.now(),
      rollingWindowDays: 30,
      typingWpm: 40,
    });

    assert.equal(stats.totalEstimatedCostUsdMicros, 130);
    assert.equal(stats.meteredSpendUsdMicros, 130);
  } finally {
    await dispose();
  }
});

async function createIncrementallyPolishedSession(store: RecordingSessionStore) {
  const session = await store.createRecordingSession({
    transcriptionProviderId: 'openai-sub',
    transcriptionModel: 'chatgpt-backend-transcribe',
  });
  const output = polishedOutput(session.id, 'output-1');
  // An incremental output carries no usage event of its own; its cost is entirely in chunk events.
  await store.createSessionOutput({ output });
  await store.selectSessionOutput({ sessionId: session.id, outputId: output.id });
  await store.createProviderUsageEvent(
    usageEvent({
      id: 'usage-chunk-1',
      sessionId: session.id,
      operationKind: 'inference',
      relatedEntityKind: 'polish_chunk',
      relatedEntityId: session.id,
      estimatedCostUsdMicros: 20,
    }),
  );

  return { session, output };
}

function totalCost(store: RecordingSessionStore) {
  return store
    .getDashboardStats({ now: Date.now(), rollingWindowDays: 30, typingWpm: 40 })
    .then((stats) => stats.totalEstimatedCostUsdMicros);
}

test('a replacement output retires the chunk cost of the output it replaces', async () => {
  const { store, dispose } = await createStore();
  try {
    const { session, output } = await createIncrementallyPolishedSession(store);
    assert.equal(await totalCost(store), 20);

    // What a rerun does: the replacement output is written in place and supersedes the chunks.
    await store.createSessionOutput({
      output: { ...output, text: 'Rewritten by the rerun.' },
      usageEvent: usageEvent({
        id: 'usage-rerun-output',
        sessionId: session.id,
        operationKind: 'inference',
        relatedEntityKind: 'session_output',
        relatedEntityId: output.id,
        estimatedCostUsdMicros: 100,
      }),
      supersedesPolishChunkUsage: true,
    });

    assert.equal(await totalCost(store), 100, 'the rerun cost replaces the chunk cost');
  } finally {
    await dispose();
  }
});

test('preparing a session for rerun keeps the chunk cost of the output it preserves', async () => {
  const { store, dispose } = await createStore();
  try {
    const { session } = await createIncrementallyPolishedSession(store);

    // Every rerun preparation preserves the selected output. A rerun that then fails or is
    // cancelled leaves that output selected, so the only records explaining its cost must survive.
    await store.clearSegmentationData(session.id, { preserveSelectedOutput: true });
    await store.selectSessionOutput({ sessionId: session.id, outputId: 'output-1' });

    assert.equal(await totalCost(store), 20);
  } finally {
    await dispose();
  }
});

test('clearing session data deletes polish chunk usage events', async () => {
  const { store, dispose } = await createStore();
  try {
    const session = await store.createRecordingSession({
      transcriptionProviderId: 'openai-sub',
      transcriptionModel: 'chatgpt-backend-transcribe',
    });
    const output = polishedOutput(session.id, 'output-1');
    await store.createSessionOutput({
      output,
      usageEvent: usageEvent({
        id: 'usage-output',
        sessionId: session.id,
        operationKind: 'inference',
        relatedEntityKind: 'session_output',
        relatedEntityId: output.id,
        estimatedCostUsdMicros: 100,
      }),
    });
    await store.selectSessionOutput({ sessionId: session.id, outputId: output.id });
    await store.createProviderUsageEvent(
      usageEvent({
        id: 'usage-chunk-1',
        sessionId: session.id,
        operationKind: 'inference',
        relatedEntityKind: 'polish_chunk',
        relatedEntityId: session.id,
        estimatedCostUsdMicros: 20,
      }),
    );

    // Discarding a session's generated data deletes its outputs, so the cost records that explain
    // them go too.
    await store.clearSegmentationData(session.id);
    await store.createSessionOutput({ output });
    await store.selectSessionOutput({ sessionId: session.id, outputId: output.id });

    const stats = await store.getDashboardStats({
      now: Date.now(),
      rollingWindowDays: 30,
      typingWpm: 40,
    });

    assert.equal(stats.totalEstimatedCostUsdMicros, 0, 'no cost survives the discard');
  } finally {
    await dispose();
  }
});

test('ordered batch transcripts carry identity and stay in sequence order', async () => {
  const { store, dispose } = await createStore();
  try {
    const session = await store.createRecordingSession({
      transcriptionProviderId: 'openai-sub',
      transcriptionModel: 'chatgpt-backend-transcribe',
    });
    await store.insertPlannedBatches({
      sessionId: session.id,
      batches: [0, 1, 2].map((sequence) => ({
        id: `batch-${sequence}`,
        sessionId: session.id,
        sequence,
        sourceDurationMs: 1_000,
        derivedAudioDurationMs: 1_000,
        createdLive: true,
        sourceRanges: [],
      })),
    });

    // Stored out of order, the way concurrent batch tasks finish.
    for (const sequence of [2, 0, 1]) {
      await store.createBatchTranscript({
        transcript: {
          id: `transcript-${sequence}`,
          batchId: `batch-${sequence}`,
          provider: 'test',
          model: 'test-model',
          text: `text ${sequence}`,
          createdAt: Date.now(),
        },
        usageEvent: usageEvent({
          id: `usage-${sequence}`,
          sessionId: session.id,
          operationKind: 'transcription',
          relatedEntityKind: 'batch_transcript',
          relatedEntityId: `transcript-${sequence}`,
          estimatedCostUsdMicros: 1,
        }),
      });
    }

    const transcripts = await store.listOrderedBatchTranscripts(session.id);
    assert.deepEqual(
      transcripts,
      [0, 1, 2].map((sequence) => ({
        batchId: `batch-${sequence}`,
        sequence,
        text: `text ${sequence}`,
      })),
    );
    assert.deepEqual(await store.listOrderedBatchTranscriptTexts(session.id), [
      'text 0',
      'text 1',
      'text 2',
    ]);
  } finally {
    await dispose();
  }
});
