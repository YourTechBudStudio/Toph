import { strict as assert } from 'node:assert';
import test from 'node:test';

import type { PolishRulePreset, ProviderUsageEvent } from '../../src/main/db/schema.ts';
import type { InferenceProvider } from '../../src/main/inference/inference-provider.ts';
import type { SessionOutputService } from '../../src/main/outputs/session-output-service.ts';
import { defaultAppSettings } from '../../src/main/settings/app-settings-schema.ts';
import type { OrderedBatchTranscript } from '../../src/main/stores/session-store.ts';
import { registerTsExtensionResolver } from '../helpers/ts-extension-resolver.ts';

registerTsExtensionResolver();

const { createPolishService } = await import('../../src/main/polish/polish-service.ts');
const { createSessionPolishCoordinator, chunkCloseThresholdChars } =
  await import('../../src/main/polish/session-polish-coordinator.ts');

const sessionId = 'session-1';

const rulePreset: PolishRulePreset = {
  id: 'engineer',
  title: 'Engineer',
  description: 'Engineer rules',
  body: 'Polish the transcript.',
  bodyHash: 'rule-hash',
  isBuiltin: true,
  sortOrder: 0,
  createdAt: 1,
  updatedAt: 1,
};

/**
 * A synthetic batch transcript of roughly `chars` characters, ending on a sentence.
 *
 * `apps/desktop/test/` is committed, so no real dictation may appear here; these fixtures only need
 * to be ordered, distinguishable, and long enough to drive the chunk threshold.
 */
function batchText(index: number, chars: number) {
  const sentence = `Batch ${index} says something worth keeping about topic ${index}. `;
  let text = '';
  while (text.length < chars) {
    text += sentence;
  }
  return `${text.trim().replace(/\.$/, '')}.`;
}

function readZone(inputText: string, tag: string) {
  const match = new RegExp(`<${tag}(?: [^>]*)?>\\n?([\\s\\S]*?)\\n?</${tag}>`).exec(inputText);
  return match?.[1] ?? null;
}

interface InferenceCall {
  instructions: string;
  inputText: string;
  context: string | null;
  tail: string | null;
  transcript: string | null;
  isFinal: boolean;
  signal: AbortSignal | undefined;
}

function createHarness(
  harnessOptions: {
    polishEnabled?: boolean;
    rulePresetAvailable?: boolean;
    /** Resolves when a call starts, so a test can hold a call in flight. */
    onInference?: (call: InferenceCall, index: number) => Promise<void>;
  } = {},
) {
  const transcripts: OrderedBatchTranscript[] = [];
  const usageEvents: ProviderUsageEvent[] = [];
  const calls: InferenceCall[] = [];
  const createdOutputs: Array<Parameters<SessionOutputService['createPolishedOutput']>[0]> = [];
  let polishEnabled = harnessOptions.polishEnabled ?? true;

  const inference: InferenceProvider = {
    id: 'test',
    async inferText({ instructions, inputText, signal }) {
      const tail = readZone(inputText, 'POLISHED_TAIL');
      const transcript = readZone(inputText, 'TRANSCRIPT');
      const call: InferenceCall = {
        instructions,
        inputText,
        context: readZone(inputText, 'POLISHED_CONTEXT'),
        tail,
        transcript,
        isFinal: inputText.includes('<TRANSCRIPT final="true">'),
        signal,
      };
      calls.push(call);
      await harnessOptions.onInference?.(call, calls.length - 1);
      if (signal?.aborted) {
        throw new Error('Inference was aborted.');
      }

      // The single-shot path gets the transcript back untouched; the incremental path gets the
      // envelope, with the tail re-emitted ahead of the new text exactly as the rules ask.
      const text =
        tail === null
          ? (transcript ?? '')
          : `<POLISHED>\n${[tail, transcript].filter((part) => part).join('\n\n')}\n</POLISHED>`;
      return {
        text,
        provider: 'test',
        model: 'test-model',
        usage: {
          billingMode: 'subscription' as const,
          audioDurationMs: null,
          billableDurationMs: null,
          inputTokens: null,
          cachedInputTokens: null,
          outputTokens: null,
          estimatedCostUsdMicros: 0,
          costSource: 'none' as const,
          pricingCatalogProviderId: null,
          pricingCatalogModelId: null,
        },
        providerRequestId: `request-${calls.length}`,
        providerResponseJson: null,
      };
    },
  };

  const settingsStore = {
    getSettings() {
      return {
        ...defaultAppSettings,
        polish: { ...defaultAppSettings.polish, enabled: polishEnabled, rulePresetId: 'engineer' },
      };
    },
  };

  const sessionStore = {
    async listOrderedBatchTranscripts() {
      return transcripts.map((transcript) => ({ ...transcript }));
    },
    async getPolishRulePreset() {
      return harnessOptions.rulePresetAvailable === false ? null : rulePreset;
    },
    async listDictionaryEntries() {
      return [];
    },
    async createProviderUsageEvent(usageEvent: ProviderUsageEvent) {
      usageEvents.push(usageEvent);
    },
  };

  const outputs = {
    async createPolishedOutput(input: Parameters<SessionOutputService['createPolishedOutput']>[0]) {
      createdOutputs.push(input);
      return {
        id: 'polished-output',
        text: input.text,
        createdAt: 5,
        rulePresetId: input.rulePresetId,
        rulePresetHash: input.rulePresetHash,
      };
    },
  };

  const polish = createPolishService({ settingsStore, sessionStore, outputs, inference });
  const coordinator = createSessionPolishCoordinator({
    settingsStore,
    sessionStore,
    outputs,
    polish,
  });

  return {
    coordinator,
    calls,
    usageEvents,
    createdOutputs,
    transcripts,
    setPolishEnabled(enabled: boolean) {
      polishEnabled = enabled;
    },
    /** Store a transcript and notify the coordinator, the way the transcription hook does. */
    async deliverBatch(sequence: number, chars: number) {
      transcripts.push({
        batchId: `batch-${sequence}`,
        sequence,
        text: batchText(sequence, chars),
      });
      transcripts.sort((left, right) => left.sequence - right.sequence);
      await coordinator.onBatchTranscribed({ sessionId });
    },
    /** Store a transcript without notifying, for a batch that is transcribed out of order. */
    storeBatch(sequence: number, chars: number) {
      transcripts.push({
        batchId: `batch-${sequence}`,
        sequence,
        text: batchText(sequence, chars),
      });
      transcripts.sort((left, right) => left.sequence - right.sequence);
    },
    rawOutputText() {
      return transcripts
        .map((transcript) => transcript.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    },
    finalize(signal?: AbortSignal) {
      return coordinator.finalizeSession({
        sessionId,
        rawOutput: { id: 'raw-output', text: this.rawOutputText() },
        signal,
      });
    },
  };
}

/** The incremental path records cost per call, so its output row carries no usage event. */
function assertIncrementalOutput(harness: ReturnType<typeof createHarness>) {
  assert.equal(harness.createdOutputs.length, 1);
  assert.equal(harness.createdOutputs[0]?.usage, null);
  assert.equal(harness.usageEvents.length, harness.calls.length);
  for (const usageEvent of harness.usageEvents) {
    assert.equal(usageEvent.relatedEntityKind, 'polish_chunk');
    assert.equal(usageEvent.relatedEntityId, sessionId);
    assert.equal(usageEvent.operationKind, 'inference');
    assert.equal(usageEvent.sessionId, sessionId);
  }
}

function assertSingleShotFallback(harness: ReturnType<typeof createHarness>) {
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0]?.tail, null, 'the fallback uses the single-shot prompt');
  assert.notEqual(harness.createdOutputs[0]?.usage, null);
  assert.equal(harness.usageEvents.length, 0);
}

test('a session under the chunk threshold makes exactly one call and falls back to single-shot', async () => {
  const harness = createHarness();
  harness.coordinator.beginSession(sessionId);
  await harness.deliverBatch(0, 300);
  await harness.deliverBatch(1, 300);
  await harness.coordinator.waitForSession(sessionId);

  const output = await harness.finalize();

  assertSingleShotFallback(harness);
  assert.equal(output.text, harness.rawOutputText());
});

test('chunks close at the first batch boundary past the threshold', async () => {
  const harness = createHarness();
  harness.coordinator.beginSession(sessionId);
  for (const sequence of [0, 1, 2, 3, 4, 5]) {
    await harness.deliverBatch(sequence, 500);
    await harness.coordinator.waitForSession(sessionId);
  }

  assert.equal(harness.calls.length, 2, 'three 500-character batches close one chunk');
  assert.ok((harness.calls[0]?.transcript?.length ?? 0) >= chunkCloseThresholdChars);
  assert.ok(harness.calls[0]?.transcript?.startsWith('Batch 0 '));
  assert.ok(harness.calls[0]?.transcript?.includes('Batch 2 '));
  assert.ok(!harness.calls[0]?.transcript?.includes('Batch 3 '));
  assert.ok(harness.calls[1]?.transcript?.startsWith('Batch 3 '));
  assert.ok(harness.calls[1]?.transcript?.includes('Batch 5 '));
});

test('every call after the first carries all three zones and re-emits the tail', async () => {
  const harness = createHarness();
  harness.coordinator.beginSession(sessionId);
  for (const sequence of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
    await harness.deliverBatch(sequence, 500);
    await harness.coordinator.waitForSession(sessionId);
  }

  assert.ok(harness.calls.length >= 3);
  assert.equal(harness.calls[0]?.context, '', 'the first call has empty context and tail zones');
  assert.equal(harness.calls[0]?.tail, '');

  for (const call of harness.calls.slice(1)) {
    assert.ok(call.inputText.includes('<POLISHED_CONTEXT>'));
    assert.ok(call.inputText.includes('<POLISHED_TAIL>'));
    assert.ok(call.inputText.includes('<TRANSCRIPT final='));
    assert.ok((call.tail?.length ?? 0) > 0, 'a later call always has a tail to revise');
    assert.ok(call.instructions.includes('# Incremental mode'));
  }

  const output = await harness.finalize();
  // The fake re-emits the tail ahead of the new text, so a dropped or duplicated tail would show up
  // as a document that is not exactly the chunk transcripts in order.
  assert.equal(output.text, harness.calls.map((call) => call.transcript).join('\n\n'));
  assertIncrementalOutput(harness);
});

test('batches arriving faster than polishing are merged into one call', async () => {
  let releaseFirstCall = () => {};
  const firstCallStarted = Promise.withResolvers<void>();
  const firstCallHeld = new Promise<void>((resolve) => {
    releaseFirstCall = resolve;
  });
  const harness = createHarness({
    async onInference(_call, index) {
      if (index === 0) {
        firstCallStarted.resolve();
        await firstCallHeld;
      }
    },
  });

  harness.coordinator.beginSession(sessionId);
  for (const sequence of [0, 1, 2]) {
    await harness.deliverBatch(sequence, 500);
  }
  await firstCallStarted.promise;

  // Six more batches land while the first call is still running.
  for (const sequence of [3, 4, 5, 6, 7, 8]) {
    await harness.deliverBatch(sequence, 500);
  }
  assert.equal(harness.calls.length, 1, 'nothing starts while a call is in flight');

  releaseFirstCall();
  await harness.coordinator.waitForSession(sessionId);

  assert.equal(harness.calls.length, 2, 'the backlog is taken by one call, not one call per chunk');
  const merged = harness.calls[1]?.transcript ?? '';
  for (const sequence of [3, 4, 5, 6, 7, 8]) {
    assert.ok(merged.includes(`Batch ${sequence} `), `batch ${sequence} is in the merged call`);
  }
});

test('a gap in the contiguous run blocks chunk closure until it fills', async () => {
  const harness = createHarness();
  harness.coordinator.beginSession(sessionId);
  await harness.deliverBatch(0, 500);

  // Batches 2 to 5 transcribe while batch 1 is still running.
  for (const sequence of [2, 3, 4, 5]) {
    await harness.deliverBatch(sequence, 500);
    await harness.coordinator.waitForSession(sessionId);
  }
  assert.equal(harness.calls.length, 0, 'a chunk cannot close over a gap');

  await harness.deliverBatch(1, 500);
  await harness.coordinator.waitForSession(sessionId);

  // One call, not one per waiting chunk: filling the gap releases the whole backlog at once.
  assert.equal(harness.calls.length, 1);
  assert.ok(harness.calls[0]?.transcript?.startsWith('Batch 0 '));
  for (const sequence of [1, 2, 3, 4, 5]) {
    assert.ok(harness.calls[0]?.transcript?.includes(`Batch ${sequence} `));
  }
});

test('a gap that survives to stop falls back to single-shot', async () => {
  const harness = createHarness();
  harness.coordinator.beginSession(sessionId);
  for (const sequence of [0, 1, 2]) {
    await harness.deliverBatch(sequence, 500);
  }
  await harness.coordinator.waitForSession(sessionId);
  assert.equal(harness.calls.length, 1);

  // Batch 3 never arrives, so batch 4's text can never be reached in spoken order.
  harness.storeBatch(4, 500);
  const output = await harness.finalize();

  assert.equal(harness.calls.length, 2);
  assert.equal(harness.calls[1]?.tail, null, 'the fallback uses the single-shot prompt');
  assert.equal(output.text, harness.rawOutputText());
});

test('a failed chunk poisons the session and finalizing falls back to single-shot', async () => {
  const harness = createHarness({
    async onInference(call) {
      if (call.tail !== null) {
        throw new Error('Inference exploded.');
      }
    },
  });

  harness.coordinator.beginSession(sessionId);
  for (const sequence of [0, 1, 2]) {
    await harness.deliverBatch(sequence, 500);
  }
  await harness.coordinator.waitForSession(sessionId);

  // A non-transient failure is not retried, so exactly one chunk call was made.
  assert.equal(harness.calls.length, 1);

  await harness.deliverBatch(3, 500);
  await harness.coordinator.waitForSession(sessionId);
  assert.equal(harness.calls.length, 1, 'a poisoned session starts no further chunks');

  const output = await harness.finalize();
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.calls[1]?.tail, null);
  assert.equal(output.text, harness.rawOutputText());
  assert.equal(harness.createdOutputs.length, 1);
  assert.notEqual(harness.createdOutputs[0]?.usage, null);
});

test('cancelling aborts the in-flight call and drops the session state', async () => {
  let abortObserved = false;
  const firstCallStarted = Promise.withResolvers<void>();
  const harness = createHarness({
    async onInference(call, index) {
      if (index !== 0) {
        return;
      }

      firstCallStarted.resolve();
      // The provider holds the call until its signal fires, so an abort that never arrives fails
      // the test instead of hanging it.
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('The in-flight chunk call was never aborted.'));
        }, 1_000);
        const onAbort = () => {
          abortObserved = true;
          clearTimeout(timeout);
          resolve();
        };
        if (call.signal?.aborted) {
          onAbort();
          return;
        }

        call.signal?.addEventListener('abort', onAbort, { once: true });
      });
    },
  });

  harness.coordinator.beginSession(sessionId);
  for (const sequence of [0, 1, 2]) {
    await harness.deliverBatch(sequence, 500);
  }
  await firstCallStarted.promise;
  await harness.coordinator.cancelSession(sessionId);

  assert.ok(abortObserved, 'the provider saw the chunk call aborted');
  assert.equal(harness.createdOutputs.length, 0);

  // State is gone, so a later finalize takes the untouched single-shot path.
  const output = await harness.finalize();
  assert.equal(harness.calls.at(-1)?.tail, null);
  assert.equal(output.text, harness.rawOutputText());
});

test('finalizing with nothing pending makes no further call', async () => {
  const harness = createHarness();
  harness.coordinator.beginSession(sessionId);
  await harness.deliverBatch(0, 700);
  await harness.deliverBatch(1, 700);
  await harness.coordinator.waitForSession(sessionId);
  assert.equal(harness.calls.length, 1, 'both batches closed one chunk');

  const output = await harness.finalize();

  assert.equal(harness.calls.length, 1, 'the stop path adds no call when nothing is pending');
  assert.equal(output.text, harness.calls[0]?.transcript);
  assertIncrementalOutput(harness);
});

test('the final chunk is marked final and the output records the last call provenance', async () => {
  const harness = createHarness();
  harness.coordinator.beginSession(sessionId);
  for (const sequence of [0, 1, 2]) {
    await harness.deliverBatch(sequence, 500);
  }
  await harness.deliverBatch(3, 400);
  await harness.coordinator.waitForSession(sessionId);

  const output = await harness.finalize();

  assert.equal(harness.calls.length, 2);
  assert.equal(harness.calls[0]?.isFinal, false);
  assert.equal(harness.calls[1]?.isFinal, true);
  assert.ok(harness.calls[1]?.transcript?.startsWith('Batch 3 '));
  assert.equal(harness.createdOutputs[0]?.sourceOutputId, 'raw-output');
  assert.equal(harness.createdOutputs[0]?.providerRequestId, 'request-2');
  assert.equal(harness.createdOutputs[0]?.rulePresetId, 'engineer');
  assert.equal(harness.createdOutputs[0]?.rulePresetHash, 'rule-hash');
  assert.equal(output.rulePresetId, 'engineer');
  assertIncrementalOutput(harness);
});

test('a session that was never begun falls back, so reruns stay single-shot', async () => {
  const harness = createHarness();
  harness.storeBatch(0, 1_500);
  await harness.coordinator.onBatchTranscribed({ sessionId });

  const output = await harness.finalize();

  assertSingleShotFallback(harness);
  assert.equal(output.text, harness.rawOutputText());
});

test('polish disabled at recording start registers nothing', async () => {
  const harness = createHarness({ polishEnabled: false });
  harness.coordinator.beginSession(sessionId);
  for (const sequence of [0, 1, 2]) {
    await harness.deliverBatch(sequence, 500);
  }
  await harness.coordinator.waitForSession(sessionId);

  assert.equal(harness.calls.length, 0);
});

test('polish disabled mid-recording starts no further chunk', async () => {
  const harness = createHarness();
  harness.coordinator.beginSession(sessionId);
  for (const sequence of [0, 1, 2]) {
    await harness.deliverBatch(sequence, 500);
  }
  await harness.coordinator.waitForSession(sessionId);
  assert.equal(harness.calls.length, 1);

  harness.setPolishEnabled(false);
  for (const sequence of [3, 4, 5]) {
    await harness.deliverBatch(sequence, 500);
    await harness.coordinator.waitForSession(sessionId);
  }

  assert.equal(harness.calls.length, 1, 'no money is spent on text the stop path will discard');
});

test('an unavailable rule preset poisons the session instead of failing the recording', async () => {
  const harness = createHarness({ rulePresetAvailable: false });
  harness.coordinator.beginSession(sessionId);
  for (const sequence of [0, 1, 2]) {
    await harness.deliverBatch(sequence, 500);
  }
  await harness.coordinator.waitForSession(sessionId);

  assert.equal(harness.calls.length, 0, 'no call is made without rules to apply');
  await assert.rejects(() => harness.finalize(), /rule preset/i);
});

test('replay: a realistic ordered batch sequence stitches into one document', async () => {
  // Lengths loosely modelled on the corpus: short opening batches, then longer stretches.
  const batchLengths = [320, 410, 260, 520, 380, 470, 610, 290, 540, 330, 480, 350];
  const harness = createHarness();
  harness.coordinator.beginSession(sessionId);

  for (const [sequence, chars] of batchLengths.entries()) {
    await harness.deliverBatch(sequence, chars);
    await harness.coordinator.waitForSession(sessionId);
  }

  const output = await harness.finalize();

  assert.equal(harness.calls.length, 4);
  for (const call of harness.calls.slice(0, -1)) {
    assert.ok(
      (call.transcript?.length ?? 0) >= chunkCloseThresholdChars,
      'no chunk closes before the threshold',
    );
  }
  assert.equal(harness.calls.at(-1)?.isFinal, true);
  assert.equal(output.text, harness.calls.map((call) => call.transcript).join('\n\n'));

  // Every batch appears exactly once, in spoken order.
  const positions = batchLengths.map((_, sequence) => output.text.indexOf(`Batch ${sequence} `));
  for (const [sequence, position] of positions.entries()) {
    assert.ok(position >= 0, `batch ${sequence} is in the stitched output`);
    if (sequence > 0) {
      assert.ok(position > (positions[sequence - 1] as number), 'batches stay in spoken order');
    }
  }
  assertIncrementalOutput(harness);
});
