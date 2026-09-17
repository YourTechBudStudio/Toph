import { randomUUID } from 'node:crypto';

import type { ProviderBillingMode } from '@toph/desktop-contracts';

import type {
  ProviderUsageEvent,
  ProviderUsageOperationKind,
  ProviderUsageRelatedEntityKind,
} from './db/schema';
import type { CostSource } from './pricing/pricing-service';

export interface ProviderUsageDetails {
  billingMode: ProviderBillingMode;
  audioDurationMs: number | null;
  billableDurationMs: number | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsdMicros: number;
  costSource: CostSource;
  pricingCatalogProviderId: string | null;
  pricingCatalogModelId: string | null;
}

/**
 * Build the usage row for one provider call.
 *
 * Every provider call that costs something records one of these, and they all map the same usage
 * details, mint the same kind of id, and serialize the provider response the same way. The caller
 * supplies only what differs: which operation it was, and what the cost is related to.
 */
export function toProviderUsageEvent(input: {
  sessionId: string;
  operationKind: ProviderUsageOperationKind;
  relatedEntityKind: ProviderUsageRelatedEntityKind;
  relatedEntityId: string;
  provider: string;
  model: string | null;
  usage: ProviderUsageDetails;
  providerRequestId: string | null;
  providerResponseJson: unknown;
  createdAt: number;
}): ProviderUsageEvent {
  return {
    id: `provider_usage_${input.createdAt}_${randomUUID()}`,
    sessionId: input.sessionId,
    operationKind: input.operationKind,
    relatedEntityKind: input.relatedEntityKind,
    relatedEntityId: input.relatedEntityId,
    provider: input.provider,
    model: input.model,
    billingMode: input.usage.billingMode,
    audioDurationMs: input.usage.audioDurationMs,
    billableDurationMs: input.usage.billableDurationMs,
    inputTokens: input.usage.inputTokens,
    cachedInputTokens: input.usage.cachedInputTokens,
    outputTokens: input.usage.outputTokens,
    estimatedCostUsdMicros: input.usage.estimatedCostUsdMicros,
    costSource: input.usage.costSource,
    pricingCatalogProviderId: input.usage.pricingCatalogProviderId,
    pricingCatalogModelId: input.usage.pricingCatalogModelId,
    providerRequestId: input.providerRequestId,
    providerResponseJson: JSON.stringify(input.providerResponseJson) ?? null,
    createdAt: input.createdAt,
  };
}
