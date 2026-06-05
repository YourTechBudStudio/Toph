import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSessionErrorReport } from '../../src/main/history/error-report.ts';
import type { RetainedSessionRecord } from '../../src/main/stores/session-store.ts';

function recordWithErrors(): RetainedSessionRecord {
  const now = Date.now();
  return {
    session: {
      id: 'session_123',
      createdAt: now,
      startedAt: now,
      endedAt: now,
      durationMs: 1000,
      rawAudioPath: '/Users/Jane Doe/.toph/recordings/session_123/raw.wav',
      transcriptionProviderId: 'openai-sub',
      transcriptionModel: 'chatgpt-backend-transcribe',
      status: 'failed',
      selectedOutputId: 'output_123',
      errorMessage:
        "Raw transcript assembly failed unexpectedly. ENOENT: open '/Users/Jane Doe/.toph/recordings/session_123/raw.wav'.",
    },
    selectedOutput: {
      id: 'output_123',
      sessionId: 'session_123',
      kind: 'raw_concat',
      text: 'private dictated transcript should never be copied',
      sourceOutputId: null,
      provider: null,
      model: null,
      rulePresetId: null,
      rulePresetHash: null,
      createdAt: now,
    },
    failedBatches: [
      {
        id: 'batch_123',
        sessionId: 'session_123',
        sequence: 2,
        status: 'failed',
        sourceDurationMs: 1000,
        derivedAudioDurationMs: 900,
        createdLive: true,
        derivedAudioPath: '/Users/Jane Doe/.toph/recordings/session_123/batches/batch_123.wav',
        createdAt: now,
        transcriptionAttempts: 3,
        transcriptionStartedAt: now,
        transcribedAt: null,
        errorMessage:
          'OpenAI-sub transcription failed for /custom data/toph/batches/batch_123.wav: HTTP 500 provider exploded.',
      },
    ],
    rawAudioAvailable: true,
  };
}

test('buildSessionErrorReport includes errors but excludes transcript text and local paths', () => {
  const report = buildSessionErrorReport(recordWithErrors(), [
    '/Users/Jane Doe/.toph',
    '/custom data/toph',
  ]);

  assert.ok(report);
  assert.match(report, /Session: session_123/);
  assert.match(report, /batch_123/);
  assert.match(report, /HTTP 500 provider exploded/);
  assert.doesNotMatch(report, /private dictated transcript/);
  assert.doesNotMatch(report, /Jane Doe/);
  assert.doesNotMatch(report, /\.toph/);
  assert.doesNotMatch(report, /custom data/);
  assert.doesNotMatch(report, /raw\.wav/);
  assert.doesNotMatch(report, /batch_123\.wav/);
});
