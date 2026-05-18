import { randomUUID } from 'node:crypto';

import type { ProviderUsageEvent } from '../db/schema';
import type { ProviderUsageDetails } from '../provider-usage';
import type { RecordingSessionStore } from '../stores/session-store';

export interface SessionOutputService {
  createRawConcatOutput: (
    sessionId: string,
    options?: { outputId?: string; allowEmpty?: boolean },
  ) => Promise<{ id: string; text: string; createdAt: number }>;
  createPolishedOutput: (options: {
    sessionId: string;
    outputId?: string;
    sourceOutputId: string;
    text: string;
    provider: string;
    model: string | null;
    usage: ProviderUsageDetails;
    providerRequestId: string | null;
    providerResponseJson: unknown;
    rulePresetId: string;
    rulePresetHash: string;
  }) => Promise<{
    id: string;
    text: string;
    createdAt: number;
    rulePresetId: string;
    rulePresetHash: string;
  }>;
  selectOutput: (options: { sessionId: string; outputId: string }) => Promise<void>;
}

function createSessionOutputId() {
  return `session_output_${Date.now()}_${randomUUID()}`;
}

function createUsageEventId() {
  return `provider_usage_${Date.now()}_${randomUUID()}`;
}

function assembleRawText(texts: string[]) {
  return texts
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createSessionOutputService(options: {
  sessionStore: Pick<
    RecordingSessionStore,
    'listOrderedBatchTranscriptTexts' | 'createSessionOutput' | 'selectSessionOutput'
  >;
}): SessionOutputService {
  return {
    async createRawConcatOutput(sessionId, createOptions) {
      const text = assembleRawText(
        await options.sessionStore.listOrderedBatchTranscriptTexts(sessionId),
      );
      if (!text && !createOptions?.allowEmpty) {
        throw new Error(`Session ${sessionId} does not have batch transcripts to assemble.`);
      }

      const output = {
        id: createOptions?.outputId ?? createSessionOutputId(),
        sessionId,
        kind: 'raw_concat' as const,
        text,
        sourceOutputId: null,
        provider: null,
        model: null,
        rulePresetId: null,
        rulePresetHash: null,
        createdAt: Date.now(),
      };

      await options.sessionStore.createSessionOutput({ output });
      return { id: output.id, text: output.text, createdAt: output.createdAt };
    },

    async createPolishedOutput(input) {
      const text = input.text.trim();
      if (!text) {
        throw new Error(`Session ${input.sessionId} produced an empty polished output.`);
      }

      const outputId = input.outputId ?? createSessionOutputId();
      const createdAt = Date.now();
      const output = {
        id: outputId,
        sessionId: input.sessionId,
        kind: 'polished' as const,
        text,
        sourceOutputId: input.sourceOutputId,
        provider: input.provider,
        model: input.model,
        rulePresetId: input.rulePresetId,
        rulePresetHash: input.rulePresetHash,
        createdAt,
      };
      const usageEvent: ProviderUsageEvent = {
        id: createUsageEventId(),
        sessionId: input.sessionId,
        operationKind: 'inference',
        relatedEntityKind: 'session_output',
        relatedEntityId: outputId,
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
        createdAt,
      };

      await options.sessionStore.createSessionOutput({ output, usageEvent });
      return {
        id: output.id,
        text: output.text,
        createdAt: output.createdAt,
        rulePresetId: output.rulePresetId,
        rulePresetHash: output.rulePresetHash,
      };
    },

    async selectOutput(input) {
      await options.sessionStore.selectSessionOutput(input);
    },
  };
}
