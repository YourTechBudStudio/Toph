import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { DEFAULT_ANTIGRAVITY_INFERENCE_MODEL } from '@toph/desktop-contracts';

import {
  createAntigravityInferenceProvider,
  resolveAntigravityModel,
} from '../../src/main/inference/providers/antigravity-inference-provider.ts';
import {
  isTransientInferenceProviderError,
  isUnsupportedInferenceImageInputError,
} from '../../src/main/inference/inference-provider.ts';

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
    provider: createAntigravityInferenceProvider({
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
            transcription: { providerId: 'openai-sub', model: 'chatgpt-backend-transcribe' },
            inference: {
              providerId: 'antigravity',
              model: options.model ?? DEFAULT_ANTIGRAVITY_INFERENCE_MODEL,
            },
            polish: { enabled: true, rulePresetId: 'general' },
            context: { screenshots: { enabled: false }, dictationPrompt: { enabled: false } },
            dashboard: { typingWpm: 50 },
            privacy: { hideFromScreenCapture: true },
            diagnostics: { enabled: false },
          };
        },
      },
    }),
  };
}

test('resolves Antigravity Gemini model aliases and thinking levels', () => {
  assert.deepEqual(resolveAntigravityModel('antigravity-gemini-3.1-pro'), {
    requestedModel: 'antigravity-gemini-3.1-pro',
    actualModel: 'gemini-3.1-pro-low',
    thinkingLevel: 'low',
  });
  assert.deepEqual(resolveAntigravityModel('antigravity-gemini-3.1-pro-high'), {
    requestedModel: 'antigravity-gemini-3.1-pro-high',
    actualModel: 'gemini-3.1-pro-high',
    thinkingLevel: 'high',
  });
  assert.deepEqual(resolveAntigravityModel('antigravity-gemini-3-flash-high'), {
    requestedModel: 'antigravity-gemini-3-flash-high',
    actualModel: 'gemini-3-flash',
    thinkingLevel: 'high',
  });
  assert.deepEqual(resolveAntigravityModel('antigravity-gemini-3.1-flash-lite'), {
    requestedModel: 'antigravity-gemini-3.1-flash-lite',
    actualModel: 'gemini-3.1-flash-lite',
    thinkingLevel: 'low',
  });
  assert.deepEqual(resolveAntigravityModel('antigravity-gemini-3.1-flash-lite-preview'), {
    requestedModel: 'antigravity-gemini-3.1-flash-lite-preview',
    actualModel: 'gemini-3.1-flash-lite',
    thinkingLevel: 'low',
  });
});

test('sends transcript and screenshot images to Antigravity generateContent', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'toph-antigravity-'));
  const imagePath = join(tempDir, 'context.jpg');
  await writeFile(imagePath, Buffer.from('fake-image'));
  let requestBody: unknown;

  const { provider, restore } = createProvider({
    model: 'antigravity-gemini-3-flash-medium',
    async fetch(_input, init) {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'Polished text.' }] } }],
          usageMetadata: {
            promptTokenCount: 12,
            cachedContentTokenCount: 2,
            candidatesTokenCount: 4,
          },
        }),
        { status: 200, headers: { 'x-request-id': 'request-1' } },
      );
    },
  });

  try {
    const result = await provider.inferText({
      instructions: 'Polish the transcript.',
      inputText: 'raw text',
      images: [{ path: imagePath, mimeType: 'image/jpeg', detail: 'low' }],
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
    assert.equal(body.model, 'gemini-3-flash');
    assert.equal(body.request?.contents?.[0]?.parts?.[0]?.text, 'raw text');
    assert.deepEqual(body.request?.contents?.[0]?.parts?.[1]?.inlineData, {
      mimeType: 'image/jpeg',
      data: Buffer.from('fake-image').toString('base64'),
    });
    assert.equal(body.request?.generationConfig?.thinkingConfig?.thinkingLevel, 'medium');
    assert.equal(result.text, 'Polished text.');
    assert.equal(result.providerRequestId, 'request-1');
    assert.equal(result.usage.inputTokens, 12);
    assert.equal(result.usage.cachedInputTokens, 2);
    assert.equal(result.usage.outputTokens, 4);
  } finally {
    restore();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('reports multimodal rejection as unsupported image input', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'toph-antigravity-'));
  const imagePath = join(tempDir, 'context.jpg');
  await writeFile(imagePath, Buffer.from('fake-image'));
  const { provider, restore } = createProvider({
    async fetch() {
      return new Response('image input not supported', { status: 400 });
    },
  });

  try {
    await assert.rejects(
      () =>
        provider.inferText({
          instructions: 'Polish the transcript.',
          inputText: 'raw text',
          images: [{ path: imagePath, mimeType: 'image/jpeg', detail: 'low' }],
        }),
      { name: 'UnsupportedInferenceImageInputError' },
    );
  } finally {
    restore();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('extracts text and usage from wrapped Antigravity inference responses', async () => {
  const { provider, restore } = createProvider({
    async fetch() {
      return new Response(
        JSON.stringify({
          response: {
            candidates: [{ content: { parts: [{ text: 'Wrapped polish.' }] } }],
            usageMetadata: {
              promptTokenCount: 21,
              cachedContentTokenCount: 3,
              candidatesTokenCount: 4,
            },
          },
        }),
        { status: 200 },
      );
    },
  });

  try {
    const result = await provider.inferText({
      instructions: 'Polish the transcript.',
      inputText: 'raw text',
    });

    assert.equal(result.text, 'Wrapped polish.');
    assert.equal(result.usage.inputTokens, 21);
    assert.equal(result.usage.cachedInputTokens, 3);
    assert.equal(result.usage.outputTokens, 4);
  } finally {
    restore();
  }
});

test('empty Antigravity inference responses remain retryable and include response details', async () => {
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
          await provider.inferText({
            instructions: 'Polish the transcript.',
            inputText: 'raw text',
          });
        } catch (error) {
          assert.equal(isTransientInferenceProviderError(error), true);
          throw error;
        }
      },
      {
        name: 'TransientInferenceProviderError',
        message: /Response: .*finishReason/,
      },
    );
  } finally {
    restore();
  }
});

test('unsupported image input errors are recognized by name', () => {
  const error = new Error('image input not supported');
  error.name = 'UnsupportedInferenceImageInputError';

  assert.equal(isUnsupportedInferenceImageInputError(error), true);
});
