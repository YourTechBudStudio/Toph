import type { DictionaryEntry, PolishRulePreset } from '../db/schema';
import type { InferenceProvider, InferenceProviderResult } from '../inference/inference-provider';
import type { SessionOutputService } from '../outputs/session-output-service';
import type { AppSettingsStore } from '../settings/app-settings-store';
import type { RecordingSessionStore } from '../stores/session-store';
import {
  cleanTrailingEllipsis,
  composeIncrementalPolishInput,
  composeIncrementalPolishInstructions,
  composePolishInstructions,
  parsePolishedResponse,
  removeEchoedContextBlocks,
  wrapTranscriptForPolish,
} from './polish-prompt';

export interface PolishChunkResult {
  text: string;
  tagged: boolean;
  removedEchoedBlockCount: number;
  provider: string;
  model: string | null;
  usage: InferenceProviderResult['usage'];
  providerRequestId: string | null;
  providerResponseJson: unknown;
  rulePresetId: string;
  rulePresetHash: string;
}

export interface PolishService {
  polishOutput: (input: {
    sessionId: string;
    rawOutput: { id: string; text: string };
    outputId?: string;
    signal?: AbortSignal;
    /** See `createSessionOutput`: set by a rerun, whose output replaces an incremental one. */
    supersedesPolishChunkUsage?: boolean;
  }) => Promise<{
    id: string;
    text: string;
    createdAt: number;
    rulePresetId: string;
    rulePresetHash: string;
  }>;
  /**
   * Polish one chunk of a still-running session against a read-only context and a rewritable tail.
   *
   * The rule preset and dictionary are inputs rather than resolved here, so a caller pins them once
   * for the whole session: `rulePresetHash` on the output row records which rule text produced the
   * text, and a preset switched mid-recording would otherwise stamp a row with a preset that
   * produced only its last chunk.
   *
   * It deliberately creates no session output row. Only the caller knows when text is final, and a
   * row per chunk would break the meaning of `session_outputs`.
   */
  polishChunk: (input: {
    sessionId: string;
    rulePreset: PolishRulePreset;
    dictionaryEntries: DictionaryEntry[];
    context: string;
    tail: string;
    transcript: string;
    isFirstChunk: boolean;
    isFinal: boolean;
    signal?: AbortSignal;
  }) => Promise<PolishChunkResult>;
}

const maxAttempts = 3;
const retryDelayMs = 1_000;

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Polish was aborted.'));
      return;
    }

    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(new Error('Polish was aborted.'));
      },
      { once: true },
    );
  });
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown Polish error.';
}

function isTransientInferenceFailure(error: unknown) {
  return error instanceof Error && error.name === 'TransientInferenceProviderError';
}

/**
 * Three attempts, retrying only transient inference failures, with abort-aware backoff of one then
 * two seconds. Shared by both polish paths so the two cannot drift apart.
 */
async function runWithPolishRetries<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  let attempt = 0;
  let lastError: unknown = null;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientInferenceFailure(error) || attempt >= maxAttempts) {
        break;
      }

      await sleep(retryDelayMs * attempt, signal);
    }
  }

  throw new Error(
    `Polish failed after ${attempt} attempt${attempt === 1 ? '' : 's'}: ${describeError(lastError)}`,
  );
}

export function createPolishService(options: {
  settingsStore: Pick<AppSettingsStore, 'getSettings'>;
  sessionStore: Pick<RecordingSessionStore, 'getPolishRulePreset' | 'listDictionaryEntries'>;
  outputs: Pick<SessionOutputService, 'createPolishedOutput'>;
  inference: InferenceProvider;
}): PolishService {
  return {
    async polishOutput(input) {
      const settings = options.settingsStore.getSettings();
      const rulePresetId = settings.polish.rulePresetId;
      if (!rulePresetId) {
        throw new Error('A Polish rule preset must be selected before polishing.');
      }

      const rulePreset = await options.sessionStore.getPolishRulePreset(rulePresetId);
      if (!rulePreset) {
        throw new Error(`Active Polish rule preset "${rulePresetId}" is not available.`);
      }
      if (!rulePreset.body) {
        throw new Error(`Active Polish rule preset "${rulePresetId}" is empty.`);
      }

      const dictionaryEntries = await options.sessionStore.listDictionaryEntries();
      const instructions = composePolishInstructions({ rulePreset, dictionaryEntries });

      return runWithPolishRetries(async () => {
        const result = await options.inference.inferText({
          instructions,
          inputText: wrapTranscriptForPolish(input.rawOutput.text),
          signal: input.signal,
        });
        if (input.signal?.aborted) {
          throw new Error('Polish was aborted.');
        }

        return options.outputs.createPolishedOutput({
          sessionId: input.sessionId,
          outputId: input.outputId,
          sourceOutputId: input.rawOutput.id,
          text: result.text,
          provider: result.provider,
          model: result.model,
          usage: result.usage,
          providerRequestId: result.providerRequestId,
          providerResponseJson: result.providerResponseJson,
          rulePresetId: rulePreset.id,
          rulePresetHash: rulePreset.bodyHash,
          supersedesPolishChunkUsage: input.supersedesPolishChunkUsage,
        });
      }, input.signal);
    },

    async polishChunk(input) {
      const { rulePreset } = input;
      if (!rulePreset.body) {
        throw new Error(`Polish rule preset "${rulePreset.id}" is empty.`);
      }

      const instructions = composeIncrementalPolishInstructions({
        rulePreset,
        dictionaryEntries: input.dictionaryEntries,
      });
      const inputText = composeIncrementalPolishInput({
        context: input.context,
        tail: input.tail,
        transcript: input.transcript,
        isFirstChunk: input.isFirstChunk,
        isFinal: input.isFinal,
      });

      return runWithPolishRetries(async () => {
        const result = await options.inference.inferText({
          instructions,
          inputText,
          signal: input.signal,
        });
        if (input.signal?.aborted) {
          throw new Error('Polish was aborted.');
        }

        const parsed = parsePolishedResponse(result.text);
        const withoutEcho = removeEchoedContextBlocks(parsed.text, input.context);
        const text = cleanTrailingEllipsis({
          text: withoutEcho.text,
          rawTranscript: input.transcript,
          isFinal: input.isFinal,
        });

        return {
          text,
          tagged: parsed.tagged,
          removedEchoedBlockCount: withoutEcho.removedBlockCount,
          provider: result.provider,
          model: result.model,
          usage: result.usage,
          providerRequestId: result.providerRequestId,
          providerResponseJson: result.providerResponseJson,
          rulePresetId: rulePreset.id,
          rulePresetHash: rulePreset.bodyHash,
        };
      }, input.signal);
    },
  };
}

export type { InferenceProviderResult };
