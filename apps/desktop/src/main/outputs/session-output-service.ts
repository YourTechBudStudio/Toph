import { randomUUID } from 'node:crypto';

import { toProviderUsageEvent, type ProviderUsageDetails } from '../provider-usage';
import type { RecordingSessionStore } from '../stores/session-store';

export interface SessionOutputService {
  createRawConcatOutput: (
    sessionId: string,
    options?: { outputId?: string; supersedesPolishChunkUsage?: boolean },
  ) => Promise<{ id: string; text: string; createdAt: number }>;
  createPolishedOutput: (options: {
    sessionId: string;
    outputId?: string;
    sourceOutputId: string;
    text: string;
    provider: string;
    model: string | null;
    /**
     * `null` records no usage event for this output, for a caller that already recorded the cost of
     * every call it made. Incremental polishing does exactly that: one `polish_chunk` event per
     * call, so an event here would double-count the final one.
     */
    usage: ProviderUsageDetails | null;
    providerRequestId: string | null;
    providerResponseJson: unknown;
    rulePresetId: string;
    rulePresetHash: string;
    /** See `createSessionOutput`: set by a rerun, whose output replaces an incremental one. */
    supersedesPolishChunkUsage?: boolean;
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

/**
 * Join batch transcripts into one raw transcript.
 *
 * Exported because incremental polishing assembles the same batch texts as it goes, and a
 * divergence here would make the polished document silently cover different text from the raw
 * output it names as its source.
 */
export function assembleRawTranscriptText(texts: string[]) {
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
      const text = assembleRawTranscriptText(
        await options.sessionStore.listOrderedBatchTranscriptTexts(sessionId),
      );
      if (!text) {
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

      await options.sessionStore.createSessionOutput({
        output,
        supersedesPolishChunkUsage: createOptions?.supersedesPolishChunkUsage,
      });
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
      const usageEvent = input.usage
        ? toProviderUsageEvent({
            sessionId: input.sessionId,
            operationKind: 'inference',
            relatedEntityKind: 'session_output',
            relatedEntityId: outputId,
            provider: input.provider,
            model: input.model,
            usage: input.usage,
            providerRequestId: input.providerRequestId,
            providerResponseJson: input.providerResponseJson,
            createdAt,
          })
        : undefined;

      await options.sessionStore.createSessionOutput({
        output,
        usageEvent,
        supersedesPolishChunkUsage: input.supersedesPolishChunkUsage,
      });
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
