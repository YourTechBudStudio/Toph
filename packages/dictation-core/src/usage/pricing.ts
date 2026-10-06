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

export interface CostEstimateInput {
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
}

/**
 * Prices one provider call. Desktop's pricing service implements it; a host that tracks no cost
 * can return `costSource: 'none'`.
 */
export interface CostEstimator {
  estimateCost: (input: CostEstimateInput) => UsageCostEstimate;
}
