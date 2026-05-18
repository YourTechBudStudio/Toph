import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { DEFAULT_ANTIGRAVITY_TRANSCRIPTION_MODEL } from '@toph/desktop-contracts';

import { createAntigravityTranscriptionProvider } from '../../src/main/transcription/providers/antigravity-transcription-provider.ts';
import { isTransientTranscriptionProviderError } from '../../src/main/transcription/transcription-provider.ts';

function createProvider(options: {
  model?: string;
  fetch: typeof fetch;
  projectId?: string | null;
}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = options.fetch;
  const restore = () => {
    globalThis.fetch = originalFetch;
  };

  return {
    restore,
    provider: createAntigravityTranscriptionProvider({
      auth: {
        async resolveCredentials() {
          return {
            accessToken: 'access-token',
            accountId: null,
            email: 'kenan@example.com',
            projectId: options.projectId ?? 'project-123',
          };
        },
      },
      pricing: {
        estimateCost() {
          return {
            costUsdMicros: 0,
            costSource: 'none',
            pricingCatalogProviderId: null,
            pricingCatalogModelId: null,
          };
        },
      },
      settingsStore: {
        getSettings() {
          return {
            version: 1,
            shortcut: { chord: { modifiers: ['control', 'alt'], key: 'Space' } },
            ruleSwitcherShortcut: { chord: { modifiers: ['control'], key: 'Space' } },
            auth: { providerId: 'openai-sub' },
            transcription: {
              providerId: 'antigravity',
              model: options.model ?? DEFAULT_ANTIGRAVITY_TRANSCRIPTION_MODEL,
            },
            inference: { providerId: 'openai-sub', model: 'gpt-5.4-mini' },
            polish: { enabled: true, rulePresetId: 'general' },
            context: { screenshots: { enabled: false }, dictationPrompt: { enabled: false } },
            dashboard: { typingWpm: 50 },
            diagnostics: { enabled: false },
          };
        },
      },
    }),
  };
}

test('sends WAV audio batches to Antigravity generateContent for transcription', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'toph-antigravity-transcription-'));
  const audioPath = join(tempDir, 'batch.wav');
  await writeFile(audioPath, Buffer.from('fake-wav'));
  let requestBody: unknown;

  const { provider, restore } = createProvider({
    model: 'antigravity-gemini-3.1-flash-lite-minimal',
    async fetch(_input, init) {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'Hello world.' }] } }],
          usageMetadata: {
            promptTokenCount: 20,
            cachedContentTokenCount: 0,
            candidatesTokenCount: 3,
          },
        }),
        { status: 200, headers: { 'x-request-id': 'request-1' } },
      );
    },
  });

  try {
    const result = await provider.transcribeBatch({
      batchId: 'batch-1',
      audioPath,
      durationMs: 2400,
    });

    const body = requestBody as {
      project?: unknown;
      model?: unknown;
      request?: {
        contents?: Array<{ parts?: Array<{ text?: string; inlineData?: unknown }> }>;
        generationConfig?: { thinkingConfig?: { thinkingLevel?: unknown } };
      };
    };
    assert.equal(body.project, 'project-123');
    assert.equal(body.model, 'gemini-3.1-flash-lite');
    assert.match(body.request?.contents?.[0]?.parts?.[0]?.text ?? '', /Return only the transcript/);
    assert.deepEqual(body.request?.contents?.[0]?.parts?.[1]?.inlineData, {
      mimeType: 'audio/wav',
      data: Buffer.from('fake-wav').toString('base64'),
    });
    assert.equal(body.request?.generationConfig?.thinkingConfig?.thinkingLevel, 'minimal');
    assert.equal(result.text, 'Hello world.');
    assert.equal(result.provider, 'antigravity');
    assert.equal(result.model, 'gemini-3.1-flash-lite');
    assert.equal(result.providerRequestId, 'request-1');
    assert.equal(result.usage.audioDurationMs, 2400);
    assert.equal(result.usage.inputTokens, 20);
    assert.equal(result.usage.outputTokens, 3);
  } finally {
    restore();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('marks retryable Antigravity transcription failures as transient', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'toph-antigravity-transcription-'));
  const audioPath = join(tempDir, 'batch.wav');
  await writeFile(audioPath, Buffer.from('fake-wav'));
  const { provider, restore } = createProvider({
    async fetch() {
      return new Response('rate limited', { status: 429 });
    },
  });

  try {
    await assert.rejects(
      () =>
        provider.transcribeBatch({
          batchId: 'batch-1',
          audioPath,
          durationMs: 2400,
        }),
      { name: 'TransientTranscriptionProviderError' },
    );
  } finally {
    restore();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('extracts transcript and usage from wrapped Antigravity responses', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'toph-antigravity-transcription-'));
  const audioPath = join(tempDir, 'batch.wav');
  await writeFile(audioPath, Buffer.from('fake-wav'));
  const { provider, restore } = createProvider({
    async fetch() {
      return new Response(
        JSON.stringify({
          response: {
            candidates: [{ content: { parts: [{ text: 'Wrapped transcript.' }] } }],
            usageMetadata: {
              promptTokenCount: 11,
              cachedContentTokenCount: 2,
              candidatesTokenCount: 3,
            },
          },
        }),
        { status: 200 },
      );
    },
  });

  try {
    const result = await provider.transcribeBatch({
      batchId: 'batch-1',
      audioPath,
      durationMs: 1200,
    });

    assert.equal(result.text, 'Wrapped transcript.');
    assert.equal(result.usage.inputTokens, 11);
    assert.equal(result.usage.cachedInputTokens, 2);
    assert.equal(result.usage.outputTokens, 3);
  } finally {
    restore();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('empty Antigravity transcription responses remain retryable and include response details', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'toph-antigravity-transcription-'));
  const audioPath = join(tempDir, 'batch.wav');
  await writeFile(audioPath, Buffer.from('fake-wav'));
  const { provider, restore } = createProvider({
    async fetch() {
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 10 },
        }),
        { status: 200 },
      );
    },
  });

  try {
    await assert.rejects(
      async () => {
        try {
          await provider.transcribeBatch({
            batchId: 'batch-1',
            audioPath,
            durationMs: 2400,
          });
        } catch (error) {
          assert.equal(isTransientTranscriptionProviderError(error), true);
          throw error;
        }
      },
      {
        name: 'TransientTranscriptionProviderError',
        message: /Response: .*finishReason/,
      },
    );
  } finally {
    restore();
    await rm(tempDir, { recursive: true, force: true });
  }
});
