import {
  createOpenAiInferenceClient,
  createPolishService,
  createSessionOutputService,
  createSessionPolishCoordinator,
  type PolishCoordinatorStore,
  type SessionOutputService,
} from '@toph/dictation-core';

// Type-only, so node tests load this file without the database or any Expo module.
import type { SessionRecords } from '../../history';
import type { PolishSources } from '../../polish';
import type { ProviderConfig } from '../../provider';
import { noCost } from './no-cost';
import type { Transcription } from './transcription';

/**
 * One run's outputs and polish: core's session-output service, polish service and incremental
 * coordinator, wired to this run's transcripts and history's writes. Built per run so `settle()` can
 * dispose everything the run started.
 */
export interface RunPolish {
  /** Writes `raw_concat` and selects outputs, through core's session-output service. */
  readonly outputs: Pick<SessionOutputService, 'createRawConcatOutput' | 'selectOutput'>;
  /** Core `beginSession`: incremental work is registered only if polish is on now. */
  begin(): void;
  onBatchTranscribed(batch: { sessionId: string }): Promise<void>;
  /** Whether polish is on now; read at stop, as desktop reads it. */
  isEnabled(): boolean;
  /** Core `finalizeSession`: the final chunk, or single-shot fallback. Writes the `polished` output. */
  finish(rawOutput: { id: string; text: string }): Promise<{ id: string; text: string }>;
  /** Aborts and awaits any chunk still running, then disposes. Safe on every path; a no-op after `finish`. */
  settle(): Promise<void>;
}

export function createRunPolish(options: {
  sessionId: string;
  config: ProviderConfig;
  sources: PolishSources;
  records: Pick<SessionRecords, 'createSessionOutput' | 'selectSessionOutput'>;
  transcripts: Pick<Transcription, 'orderedTranscripts'>;
}): RunPolish {
  const { sessionId, sources } = options;
  const listOrdered = async () => options.transcripts.orderedTranscripts();
  const outputs = createSessionOutputService({
    sessionStore: {
      listOrderedBatchTranscriptTexts: async () =>
        (await listOrdered()).map((transcript) => transcript.text),
      createSessionOutput: options.records.createSessionOutput,
      selectSessionOutput: options.records.selectSessionOutput,
    },
  });
  const inference = createOpenAiInferenceClient({
    credentials: options.config.credentials,
    settings: () => ({ inference: options.config.inference() }),
    pricing: noCost,
    billingMode: 'metered',
  });
  const sessionStore: PolishCoordinatorStore = {
    getPolishRulePreset: sources.getPolishRulePreset,
    listDictionaryEntries: sources.listDictionaryEntries,
    listOrderedBatchTranscripts: listOrdered,
    createProviderUsageEvent: async () => {}, // no cost tracking on mobile
  };
  const service = createPolishService({
    settingsStore: sources,
    sessionStore,
    outputs,
    resolveInferenceClient: () => inference,
  });
  const coordinator = createSessionPolishCoordinator({
    settingsStore: sources,
    sessionStore,
    outputs,
    polish: service,
  });

  return {
    outputs,
    begin: () => coordinator.beginSession(sessionId),
    onBatchTranscribed: (batch) => coordinator.onBatchTranscribed(batch),
    isEnabled: () => sources.getSettings().polish.enabled,
    async finish(rawOutput) {
      const polished = await coordinator.finalizeSession({ sessionId, rawOutput });
      return { id: polished.id, text: polished.text };
    },
    async settle() {
      await coordinator.cancelSession(sessionId);
      await coordinator.dispose();
    },
  };
}
