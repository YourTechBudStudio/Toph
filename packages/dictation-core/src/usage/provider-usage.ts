import type { ProviderBillingMode } from '@toph/desktop-contracts';

import { createId } from '../ids';
import type { CostSource } from './pricing';

export type ProviderUsageOperationKind = 'transcription' | 'inference';
/**
 * `polish_chunk` events belong to a session rather than to a row: an incremental polish call has no
 * transcript and no output row of its own, so its cost is recorded against the session directly.
 */
export type ProviderUsageRelatedEntityKind = 'batch_transcript' | 'session_output' | 'polish_chunk';

/**
 * One `provider_usage_events` row. Mirrors the desktop schema until the schema itself moves into
 * shared code.
 */
export interface ProviderUsageEventRecord {
  id: string;
  sessionId: string;
  operationKind: ProviderUsageOperationKind;
  relatedEntityKind: ProviderUsageRelatedEntityKind;
  relatedEntityId: string;
  provider: string;
  model: string | null;
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
  providerRequestId: string | null;
  providerResponseJson: string | null;
  createdAt: number;
}

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
}): ProviderUsageEventRecord {
  return {
    id: createId('provider_usage', input.createdAt),
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
