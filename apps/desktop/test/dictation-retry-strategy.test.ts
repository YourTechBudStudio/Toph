import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDictationRetryStrategy } from '../src/main/dictation-retry-strategy.ts';

const settings = {
  transcription: { providerId: 'openai-sub' as const, model: 'chatgpt-backend-transcribe' },
};

function session(
  overrides: Partial<Parameters<typeof resolveDictationRetryStrategy>[0]['session']> = {},
) {
  return {
    status: 'failed' as const,
    transcriptionProviderId: 'openai-sub',
    transcriptionModel: 'chatgpt-backend-transcribe',
    ...overrides,
  };
}

function batch(
  overrides: Partial<Parameters<typeof resolveDictationRetryStrategy>[0]['batches'][number]> = {},
) {
  return {
    id: 'batch-1',
    status: 'failed' as const,
    derivedAudioPath: '/tmp/batch.wav',
    ...overrides,
  };
}

test('retries only incomplete batches when snapshot matches and batch audio exists', () => {
  const strategy = resolveDictationRetryStrategy({
    session: session(),
    batches: [
      batch({ id: 'batch-1', status: 'transcribed' }),
      batch({ id: 'batch-2', status: 'failed' }),
    ],
    settings,
    batchAudioExists: () => true,
  });

  assert.deepEqual(strategy, {
    kind: 'retry-failed-transcription-batches',
    batchIds: ['batch-2'],
  });
});

test('falls back to full rerun when the stored transcription snapshot is missing', () => {
  const strategy = resolveDictationRetryStrategy({
    session: session({ transcriptionProviderId: null, transcriptionModel: null }),
    batches: [batch()],
    settings,
    batchAudioExists: () => true,
  });

  assert.deepEqual(strategy, { kind: 'full-rerun' });
});

test('falls back to full rerun when incomplete batch audio is missing', () => {
  const strategy = resolveDictationRetryStrategy({
    session: session(),
    batches: [batch()],
    settings,
    batchAudioExists: () => false,
  });

  assert.deepEqual(strategy, { kind: 'full-rerun' });
});

test('regenerates output when every existing batch is transcribed and the snapshot matches', () => {
  const strategy = resolveDictationRetryStrategy({
    session: session({ status: 'completed' }),
    batches: [batch({ status: 'transcribed' })],
    settings,
    batchAudioExists: () => true,
  });

  assert.deepEqual(strategy, { kind: 'regenerate-output-from-existing-transcripts' });
});
