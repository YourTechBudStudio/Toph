import { readFile, writeFile } from 'node:fs/promises';

import type { ProviderId } from '@toph/desktop-contracts';

export type CostSource = 'provider_reported' | 'models_dev' | 'static_fallback' | 'none';

export interface UsageCostEstimate {
  costUsdMicros: number;
  costSource: CostSource;
  pricingCatalogProviderId: string | null;
  pricingCatalogModelId: string | null;
}

export interface TokenUsage {
  kind: 'tokens';
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export interface AudioDurationUsage {
  kind: 'audio_duration';
  durationMs: number;
}

export type PricingUsage = TokenUsage | AudioDurationUsage;

interface ModelsDevModel {
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
  };
}

interface ModelsDevProvider {
  models?: Record<string, ModelsDevModel>;
}

interface ModelsDevCacheFile {
  fetchedAt: number;
  sourceUrl: string;
  providers: Record<string, ModelsDevProvider>;
}

interface ModelPricingMapping {
  catalogProviderId: string;
  catalogModelId: string | null;
  fallbackPricing?: {
    usdPerMinute?: number;
    inputUsdPerMillionTokens?: number;
    cachedInputUsdPerMillionTokens?: number;
    outputUsdPerMillionTokens?: number;
  };
}

const modelsDevUrl = 'https://models.dev/api.json';
const refreshIntervalMs = 24 * 60 * 60 * 1000;

const providerPricingMappings: Record<ProviderId, Record<string, ModelPricingMapping>> = {
  'openai-sub': {
    'chatgpt-backend-transcribe': {
      catalogProviderId: 'openai',
      catalogModelId: null,
      fallbackPricing: {
        usdPerMinute: 0.003,
      },
    },
    'gpt-5.4-mini': {
      catalogProviderId: 'openai',
      catalogModelId: 'gpt-5.4-mini',
      fallbackPricing: {
        inputUsdPerMillionTokens: 0.75,
        cachedInputUsdPerMillionTokens: 0.075,
        outputUsdPerMillionTokens: 4.5,
      },
    },
  },
  antigravity: {},
};

export interface PricingService {
  refreshModelsDevCatalog: () => Promise<void>;
  refreshModelsDevCatalogInBackground: () => void;
  estimateCost: (input: {
    providerId: ProviderId;
    model: string | null;
    usage: PricingUsage;
  }) => UsageCostEstimate;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseModelsDevCache(value: unknown): ModelsDevCacheFile | null {
  if (!isObject(value) || typeof value.fetchedAt !== 'number' || !isObject(value.providers)) {
    return null;
  }

  return value as unknown as ModelsDevCacheFile;
}

function usdToMicros(usd: number) {
  return Math.max(0, Math.round(usd * 1_000_000));
}

function resolveMapping(providerId: ProviderId, model: string | null): ModelPricingMapping | null {
  const providerMappings = providerPricingMappings[providerId];
  if (!providerMappings || !model) {
    return null;
  }

  return (
    providerMappings[model] ?? {
      catalogProviderId: providerId === 'openai-sub' ? 'openai' : providerId,
      catalogModelId: model,
    }
  );
}

function fromFallback(mapping: ModelPricingMapping, usage: PricingUsage): UsageCostEstimate | null {
  if (usage.kind === 'audio_duration' && mapping.fallbackPricing?.usdPerMinute !== undefined) {
    return {
      costUsdMicros: usdToMicros(
        (usage.durationMs / 60_000) * mapping.fallbackPricing.usdPerMinute,
      ),
      costSource: 'static_fallback',
      pricingCatalogProviderId: mapping.catalogProviderId,
      pricingCatalogModelId: mapping.catalogModelId,
    };
  }

  if (
    usage.kind === 'tokens' &&
    mapping.fallbackPricing?.inputUsdPerMillionTokens !== undefined &&
    mapping.fallbackPricing.outputUsdPerMillionTokens !== undefined
  ) {
    const cachedInputTokens = Math.min(usage.cachedInputTokens, usage.inputTokens);
    const regularInputTokens = Math.max(0, usage.inputTokens - cachedInputTokens);
    const cachedRate =
      mapping.fallbackPricing.cachedInputUsdPerMillionTokens ??
      mapping.fallbackPricing.inputUsdPerMillionTokens;
    const costUsd =
      (regularInputTokens / 1_000_000) * mapping.fallbackPricing.inputUsdPerMillionTokens +
      (cachedInputTokens / 1_000_000) * cachedRate +
      (usage.outputTokens / 1_000_000) * mapping.fallbackPricing.outputUsdPerMillionTokens;
    return {
      costUsdMicros: usdToMicros(costUsd),
      costSource: 'static_fallback',
      pricingCatalogProviderId: mapping.catalogProviderId,
      pricingCatalogModelId: mapping.catalogModelId,
    };
  }

  return null;
}

function fromModelsDev(
  cache: ModelsDevCacheFile | null,
  mapping: ModelPricingMapping,
  usage: PricingUsage,
): UsageCostEstimate | null {
  if (usage.kind !== 'tokens' || !mapping.catalogModelId) {
    return null;
  }

  const cost = cache?.providers[mapping.catalogProviderId]?.models?.[mapping.catalogModelId]?.cost;
  if (!cost || cost.input === undefined || cost.output === undefined) {
    return null;
  }

  const cachedInputTokens = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const regularInputTokens = Math.max(0, usage.inputTokens - cachedInputTokens);
  const cachedRate = cost.cache_read ?? cost.input;
  const costUsd =
    (regularInputTokens / 1_000_000) * cost.input +
    (cachedInputTokens / 1_000_000) * cachedRate +
    (usage.outputTokens / 1_000_000) * cost.output;

  return {
    costUsdMicros: usdToMicros(costUsd),
    costSource: 'models_dev',
    pricingCatalogProviderId: mapping.catalogProviderId,
    pricingCatalogModelId: mapping.catalogModelId,
  };
}

export async function createPricingService(options: {
  modelsDevCachePath: string;
}): Promise<PricingService> {
  let cache: ModelsDevCacheFile | null = null;
  let refreshTask: Promise<void> | null = null;

  const loadCache = async () => {
    try {
      cache = parseModelsDevCache(JSON.parse(await readFile(options.modelsDevCachePath, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Toph pricing catalog cache could not be read.', error);
      }
      cache = null;
    }
  };

  const refreshModelsDevCatalog = async () => {
    const response = await fetch(modelsDevUrl);
    if (!response.ok) {
      throw new Error(`models.dev pricing catalog failed: HTTP ${response.status}`);
    }

    const providers = (await response.json()) as Record<string, ModelsDevProvider>;
    cache = {
      fetchedAt: Date.now(),
      sourceUrl: modelsDevUrl,
      providers,
    };
    await writeFile(options.modelsDevCachePath, `${JSON.stringify(cache)}\n`, { mode: 0o600 });
  };

  await loadCache();

  const service: PricingService = {
    refreshModelsDevCatalog,

    refreshModelsDevCatalogInBackground() {
      if (refreshTask || (cache && Date.now() - cache.fetchedAt < refreshIntervalMs)) {
        return;
      }

      refreshTask = refreshModelsDevCatalog()
        .catch((error: unknown) => {
          console.warn('Toph pricing catalog refresh failed.', error);
        })
        .finally(() => {
          refreshTask = null;
        });
    },

    estimateCost(input) {
      const mapping = resolveMapping(input.providerId, input.model);
      if (!mapping) {
        return {
          costUsdMicros: 0,
          costSource: 'none',
          pricingCatalogProviderId: null,
          pricingCatalogModelId: null,
        };
      }

      return (
        fromModelsDev(cache, mapping, input.usage) ??
        fromFallback(mapping, input.usage) ?? {
          costUsdMicros: 0,
          costSource: 'none',
          pricingCatalogProviderId: mapping.catalogProviderId,
          pricingCatalogModelId: mapping.catalogModelId,
        }
      );
    },
  };

  service.refreshModelsDevCatalogInBackground();
  return service;
}
