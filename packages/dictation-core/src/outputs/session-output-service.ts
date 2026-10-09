import type { SessionOutput } from '../db/schema';
import { createId } from '../ids';
import { assembleRawTranscriptText } from '../transcription/raw-transcript';
import {
  toProviderUsageEvent,
  type ProviderUsageDetails,
  type ProviderUsageEventRecord,
} from '../usage/provider-usage';

/** Where session outputs are read from and written to. Desktop's `RecordingSessionStore` satisfies it. */
export interface SessionOutputStore {
  listOrderedBatchTranscriptTexts: (sessionId: string) => Promise<string[]>;
  createSessionOutput: (options: {
    output: SessionOutput;
    usageEvent?: ProviderUsageEventRecord | undefined;
    supersedesPolishChunkUsage?: boolean | undefined;
  }) => Promise<void>;
  selectSessionOutput: (options: { sessionId: string; outputId: string }) => Promise<void>;
}

export interface SessionOutputService {
  createRawConcatOutput: (
    sessionId: string,
    options?: { outputId?: string | undefined; supersedesPolishChunkUsage?: boolean | undefined },
  ) => Promise<{ id: string; text: string; createdAt: number }>;
  createPolishedOutput: (options: {
    sessionId: string;
    outputId?: string | undefined;
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
    supersedesPolishChunkUsage?: boolean | undefined;
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
  return createId('session_output');
}

export function createSessionOutputService(options: {
  sessionStore: SessionOutputStore;
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
