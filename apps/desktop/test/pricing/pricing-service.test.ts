import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createPricingService } from '../../src/main/pricing/pricing-service.ts';

async function createServiceWithCatalog(catalog: unknown) {
  const directory = await mkdtemp(join(tmpdir(), 'toph-pricing-test-'));
  const cachePath = join(directory, 'models-dev.json');
  await writeFile(cachePath, `${JSON.stringify(catalog)}\n`);
  return createPricingService({ modelsDevCachePath: cachePath });
}

test('estimates token cost from models.dev pricing without double-counting cached input', async () => {
  const service = await createServiceWithCatalog({
    fetchedAt: Date.now(),
    sourceUrl: 'https://models.dev/api.json',
    providers: {
      openai: {
        models: {
          'gpt-5.4-mini': {
            cost: {
              input: 0.75,
              cache_read: 0.075,
              output: 4.5,
            },
          },
        },
      },
    },
  });

  const estimate = service.estimateCost({
    providerId: 'openai-sub',
    model: 'gpt-5.4-mini',
    usage: {
      kind: 'tokens',
      inputTokens: 1_000_000,
      cachedInputTokens: 250_000,
      outputTokens: 100_000,
    },
  });

  assert.deepEqual(estimate, {
    costUsdMicros: 1_031_250,
    costSource: 'models_dev',
    pricingCatalogProviderId: 'openai',
    pricingCatalogModelId: 'gpt-5.4-mini',
  });
});

test('uses static duration fallback for ChatGPT backend transcription pricing', async () => {
  const service = await createServiceWithCatalog({
    fetchedAt: Date.now(),
    sourceUrl: 'https://models.dev/api.json',
    providers: {},
  });

  const estimate = service.estimateCost({
    providerId: 'openai-sub',
    model: 'chatgpt-backend-transcribe',
    usage: {
      kind: 'audio_duration',
      durationMs: 120_000,
    },
  });

  assert.deepEqual(estimate, {
    costUsdMicros: 6_000,
    costSource: 'static_fallback',
    pricingCatalogProviderId: 'openai',
    pricingCatalogModelId: null,
  });
});

test('prices an OpenAI model by exact id in the OpenAI catalog', async () => {
  const service = await createServiceWithCatalog({
    fetchedAt: Date.now(),
    sourceUrl: 'https://models.dev/api.json',
    providers: {
      openai: {
        models: {
          'gpt-4o': { cost: { input: 2.5, cache_read: 1.25, output: 10 } },
          'gpt-4o-mini': { cost: { input: 0.15, cache_read: 0.075, output: 0.6 } },
        },
      },
    },
  });

  const estimate = service.estimateCost({
    providerId: 'openai',
    model: 'GPT-4o ',
    usage: {
      kind: 'tokens',
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      outputTokens: 1_000_000,
    },
  });

  assert.deepEqual(estimate, {
    costUsdMicros: 12_500_000,
    costSource: 'models_dev',
    pricingCatalogProviderId: 'openai',
    pricingCatalogModelId: 'gpt-4o',
  });
});

test('falls back to an exact id under another catalog provider, for proxied endpoints', async () => {
  const service = await createServiceWithCatalog({
    fetchedAt: Date.now(),
    sourceUrl: 'https://models.dev/api.json',
    providers: {
      openai: { models: {} },
      anthropic: {
        models: {
          'claude-sonnet-4-5': { cost: { input: 3, output: 15 } },
        },
      },
    },
  });

  const estimate = service.estimateCost({
    providerId: 'openai',
    model: 'claude-sonnet-4-5',
    usage: {
      kind: 'tokens',
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      outputTokens: 0,
    },
  });

  assert.deepEqual(estimate, {
    costUsdMicros: 3_000_000,
    costSource: 'models_dev',
    pricingCatalogProviderId: 'anthropic',
    pricingCatalogModelId: 'claude-sonnet-4-5',
  });
});

test('reports no cost for a near miss rather than pricing a neighbouring model', async () => {
  const service = await createServiceWithCatalog({
    fetchedAt: Date.now(),
    sourceUrl: 'https://models.dev/api.json',
    providers: {
      openai: {
        models: {
          'gpt-4o-mini': { cost: { input: 0.15, output: 0.6 } },
        },
      },
    },
  });

  const estimate = service.estimateCost({
    providerId: 'openai',
    model: 'gpt-4o',
    usage: {
      kind: 'tokens',
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      outputTokens: 1_000_000,
    },
  });

  assert.deepEqual(estimate, {
    costUsdMicros: 0,
    costSource: 'none',
    pricingCatalogProviderId: null,
    pricingCatalogModelId: null,
  });
});

test('prices OpenAI transcription from static rates, which the catalog never carries', async () => {
  const service = await createServiceWithCatalog({
    fetchedAt: Date.now(),
    sourceUrl: 'https://models.dev/api.json',
    providers: { openai: { models: {} } },
  });

  assert.deepEqual(
    service.estimateCost({
      providerId: 'openai',
      model: 'gpt-4o-transcribe',
      usage: { kind: 'audio_duration', durationMs: 120_000 },
    }),
    {
      costUsdMicros: 12_000,
      costSource: 'static_fallback',
      pricingCatalogProviderId: 'openai',
      pricingCatalogModelId: null,
    },
  );

  assert.equal(
    service.estimateCost({
      providerId: 'openai',
      model: 'gpt-4o-mini-transcribe',
      usage: { kind: 'audio_duration', durationMs: 60_000 },
    }).costUsdMicros,
    3_000,
  );

  assert.equal(
    service.estimateCost({
      providerId: 'openai',
      model: 'whisper-1',
      usage: { kind: 'audio_duration', durationMs: 60_000 },
    }).costUsdMicros,
    6_000,
  );
});

test('withholds static rates when the client says it is not the official endpoint', async () => {
  const service = await createServiceWithCatalog({
    fetchedAt: Date.now(),
    sourceUrl: 'https://models.dev/api.json',
    providers: { openai: { models: {} } },
  });

  assert.deepEqual(
    service.estimateCost({
      providerId: 'openai',
      model: 'whisper-1',
      usage: { kind: 'audio_duration', durationMs: 60_000 },
      allowStaticFallback: false,
    }),
    {
      costUsdMicros: 0,
      costSource: 'none',
      pricingCatalogProviderId: null,
      pricingCatalogModelId: null,
    },
  );
});

test('a catalog hit still prices a third-party endpoint, because it prices the model itself', async () => {
  const service = await createServiceWithCatalog({
    fetchedAt: Date.now(),
    sourceUrl: 'https://models.dev/api.json',
    providers: {
      openai: {
        models: {
          'gpt-4o': { cost: { input: 2.5, output: 10 } },
        },
      },
    },
  });

  assert.equal(
    service.estimateCost({
      providerId: 'openai',
      model: 'gpt-4o',
      usage: {
        kind: 'tokens',
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        outputTokens: 0,
      },
      allowStaticFallback: false,
    }).costSource,
    'models_dev',
  );
});
