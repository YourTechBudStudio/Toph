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

interface FallbackPricing {
  usdPerMinute?: number;
  inputUsdPerMillionTokens?: number;
  cachedInputUsdPerMillionTokens?: number;
  outputUsdPerMillionTokens?: number;
}

/** A model this app prices explicitly, rather than leaving to a catalog lookup. */
interface ModelPricingMapping {
  /** `null` when the catalog has no entry for it, so only the static fallback can price it. */
  catalogModelId: string | null;
  fallbackPricing?: FallbackPricing;
}

interface ProviderPricingMapping {
  /** The models.dev catalog this provider's models are looked up under by default. */
  catalogProviderId: string;
  models: Record<string, ModelPricingMapping>;
}

/** Where a model's price came from, after resolution. */
interface ResolvedPricing {
  catalogProviderId: string;
  catalogModelId: string | null;
  fallbackPricing?: FallbackPricing;
}

const modelsDevUrl = 'https://models.dev/api.json';
const refreshIntervalMs = 24 * 60 * 60 * 1000;

const providerPricingMappings: Record<ProviderId, ProviderPricingMapping> = {
  'openai-sub': {
    catalogProviderId: 'openai',
    models: {
      'chatgpt-backend-transcribe': {
        catalogModelId: null,
        fallbackPricing: {
          usdPerMinute: 0.003,
        },
      },
      'gpt-5.4-mini': {
        catalogModelId: 'gpt-5.4-mini',
        fallbackPricing: {
          inputUsdPerMillionTokens: 0.75,
          cachedInputUsdPerMillionTokens: 0.075,
          outputUsdPerMillionTokens: 4.5,
        },
      },
    },
  },
  openai: {
    catalogProviderId: 'openai',
    // models.dev carries no audio pricing for OpenAI at all, so for transcription these static
    // rates are the only path that will ever run, not a fallback. Verified against OpenAI's
    // published pricing on 2026-09-18.
    models: {
      'gpt-4o-transcribe': {
        catalogModelId: null,
        fallbackPricing: {
          usdPerMinute: 0.006,
        },
      },
      'gpt-4o-mini-transcribe': {
        catalogModelId: null,
        fallbackPricing: {
          usdPerMinute: 0.003,
        },
      },
      'whisper-1': {
        catalogModelId: null,
        fallbackPricing: {
          usdPerMinute: 0.006,
        },
      },
    },
  },
};

export interface PricingService {
  refreshModelsDevCatalog: () => Promise<void>;
  refreshModelsDevCatalogInBackground: () => void;
  estimateCost: (input: {
    providerId: ProviderId;
    model: string | null;
    usage: PricingUsage;
    /**
     * Whether this app's own hardcoded rates may be applied. A client calling an endpoint other
     * than the provider's official one passes `false`: the published rates are that vendor's
     * prices and mean nothing for a third-party or self-hosted host, so no estimate is the honest
     * answer. Catalog lookups are unaffected, because a catalog hit prices the model itself.
     * Defaults to `true` for callers that only ever reach the official endpoint.
     */
    allowStaticFallback?: boolean;
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

/**
 * Finds where a model's price should come from. Exact ids only, at every step: neighbouring model
 * names carry very different prices, so pricing `gpt-4o` as `gpt-4o-mini` would be worse than
 * reporting nothing. Pure in the cache so it can be tested without a service.
 *
 * Order: this app's explicit entry for the model, then the provider's own catalog, then any other
 * catalog provider by key order (an exact id shared across catalogs is the same model in practice,
 * and this is what lets an arbitrary OpenAI-compatible endpoint price a model it proxies).
 */
function resolveModelPricing(
  cache: ModelsDevCacheFile | null,
  providerId: ProviderId,
  model: string | null,
): ResolvedPricing | null {
  const provider = providerPricingMappings[providerId];
  if (!provider || !model) {
    return null;
  }

  const normalized = model.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const declared = provider.models[normalized];
  if (declared) {
    return { catalogProviderId: provider.catalogProviderId, ...declared };
  }

  if (cache?.providers[provider.catalogProviderId]?.models?.[normalized]) {
    return { catalogProviderId: provider.catalogProviderId, catalogModelId: normalized };
  }

  for (const [catalogProviderId, catalogProvider] of Object.entries(cache?.providers ?? {})) {
    if (catalogProvider.models?.[normalized]) {
      return { catalogProviderId, catalogModelId: normalized };
    }
  }

  return null;
}

function fromFallback(mapping: ResolvedPricing, usage: PricingUsage): UsageCostEstimate | null {
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
  mapping: ResolvedPricing,
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
      const mapping = resolveModelPricing(cache, input.providerId, input.model);
      const priced = mapping
        ? (fromModelsDev(cache, mapping, input.usage) ??
          (input.allowStaticFallback === false ? null : fromFallback(mapping, input.usage)))
        : null;

      // Catalog fields describe where a price came from, so they stay null when there is no price;
      // naming a catalog beside `costSource: 'none'` reads as an estimate that was never computed.
      return (
        priced ?? {
          costUsdMicros: 0,
          costSource: 'none',
          pricingCatalogProviderId: null,
          pricingCatalogModelId: null,
        }
      );
    },
  };

  service.refreshModelsDevCatalogInBackground();
  return service;
}
