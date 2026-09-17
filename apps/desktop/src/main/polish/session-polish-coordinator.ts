import type { DictionaryEntry, PolishRulePreset } from '../db/schema';
import {
  assembleRawTranscriptText,
  type SessionOutputService,
} from '../outputs/session-output-service';
import { toProviderUsageEvent } from '../provider-usage';
import type { AppSettingsStore } from '../settings/app-settings-store';
import type { RecordingSessionStore } from '../stores/session-store';
import type { PolishChunkResult, PolishService } from './polish-service';
import { selectContextWindow, splitRewritableTail } from './polished-text-blocks';

export interface SessionPolishCoordinator {
  /**
   * Register a live recording. Only registered sessions accumulate, so a rerun transcribing the
   * same batches never triggers incremental work.
   */
  beginSession: (sessionId: string) => void;
  /** Resolves once accumulation is updated and any resulting chunk call has been *started*. */
  onBatchTranscribed: (batch: { sessionId: string }) => Promise<void>;
  /** Awaits any in-flight chunk work for the session. */
  waitForSession: (sessionId: string) => Promise<void>;
  finalizeSession: (input: {
    sessionId: string;
    rawOutput: { id: string; text: string };
    outputId?: string;
    signal?: AbortSignal;
  }) => Promise<{
    id: string;
    text: string;
    createdAt: number;
    rulePresetId: string;
    rulePresetHash: string;
  }>;
  cancelSession: (sessionId: string) => Promise<void>;
  dispose: () => Promise<void>;
}

/**
 * A chunk closes at the first batch boundary past this many raw characters. From
 * `artifacts/analysis-3-chunking.md`: 800 costs about 46% more tokens for no latency gain, 1800 and
 * 2500 make the stop wait worse, and at 1200 only 7% of boundaries land mid-sentence.
 */
export const chunkCloseThresholdChars = 1_200;

interface PolishCallProvenance {
  provider: string;
  model: string | null;
  providerRequestId: string | null;
  providerResponseJson: unknown;
  rulePresetId: string;
  rulePresetHash: string;
}

interface SessionPolishState {
  /** The next batch sequence to consume. A gap stops the advance; later batches wait behind it. */
  nextSequence: number;
  pendingTexts: string[];
  /** Everything polished so far. `frozen` and `tail` are two views of this same text. */
  document: string;
  frozen: string;
  tail: string;
  polishedChunkCount: number;
  lastCall: PolishCallProvenance | null;
  /** Pinned at the first chunk, so one session produces one coherent document (phase 03). */
  rulePreset: PolishRulePreset | null;
  dictionaryEntries: DictionaryEntry[] | null;
  /** Serializes accumulation, so concurrently transcribed batches cannot double-append. */
  queue: Promise<void>;
  inFlight: Promise<void> | null;
  abortControllers: Set<AbortController>;
  /** Set when incremental state became unusable. Finalizing then falls back to single-shot (D7). */
  poisoned: boolean;
  /** Set once the session is finalizing, cancelled or disposed. No further chunk may start. */
  closed: boolean;
}

function createSessionPolishState(): SessionPolishState {
  return {
    nextSequence: 0,
    pendingTexts: [],
    document: '',
    frozen: '',
    tail: '',
    polishedChunkCount: 0,
    lastCall: null,
    rulePreset: null,
    dictionaryEntries: null,
    queue: Promise.resolve(),
    inFlight: null,
    abortControllers: new Set(),
    poisoned: false,
    closed: false,
  };
}

export function createSessionPolishCoordinator(options: {
  settingsStore: Pick<AppSettingsStore, 'getSettings'>;
  sessionStore: Pick<
    RecordingSessionStore,
    | 'listOrderedBatchTranscripts'
    | 'getPolishRulePreset'
    | 'listDictionaryEntries'
    | 'createProviderUsageEvent'
  >;
  outputs: Pick<SessionOutputService, 'createPolishedOutput'>;
  polish: PolishService;
}): SessionPolishCoordinator {
  const sessions = new Map<string, SessionPolishState>();

  const polishIsEnabled = () => options.settingsStore.getSettings().polish.enabled;

  const pendingText = (state: SessionPolishState) => assembleRawTranscriptText(state.pendingTexts);

  const poison = (state: SessionPolishState) => {
    state.poisoned = true;
    state.pendingTexts = [];
    state.document = '';
    state.frozen = '';
    state.tail = '';
    state.polishedChunkCount = 0;
    state.lastCall = null;
  };

  const abortSession = (state: SessionPolishState) => {
    for (const abortController of state.abortControllers) {
      abortController.abort();
    }
  };

  /** Run `task` after whatever accumulation work is already queued for this session. */
  const enqueue = async <T>(state: SessionPolishState, task: () => Promise<T>): Promise<T> => {
    const result = state.queue.then(task, task);
    state.queue = result.then(
      () => {},
      () => {},
    );
    return result;
  };

  /**
   * Append the contiguous run of transcribed batches starting at `nextSequence`.
   *
   * Live batch sequences are assigned monotonically from zero, so a missing sequence is a batch that
   * is not transcribed yet. Stopping there is what keeps the polished text in spoken order when a
   * middle batch is slow or failed (D6).
   */
  const consumeTranscribedBatches = async (sessionId: string, state: SessionPolishState) => {
    const transcripts = await options.sessionStore.listOrderedBatchTranscripts(sessionId);
    for (const transcript of transcripts) {
      if (transcript.sequence !== state.nextSequence) {
        continue;
      }

      state.pendingTexts.push(transcript.text);
      state.nextSequence += 1;
    }

    return transcripts;
  };

  /**
   * Resolve the rule preset and dictionary at the first chunk and reuse that pair for every later
   * chunk, including the final one.
   *
   * Pinning is what makes `rulePresetHash` on the output row mean something: resolving per call
   * would stamp a row with whichever preset happened to be active at stop, and a preset deleted
   * mid-recording would turn into a throw at stop rather than a fallback.
   */
  const resolvePinnedRules = async (state: SessionPolishState) => {
    if (state.rulePreset && state.dictionaryEntries) {
      return { rulePreset: state.rulePreset, dictionaryEntries: state.dictionaryEntries };
    }

    const rulePresetId = options.settingsStore.getSettings().polish.rulePresetId;
    if (!rulePresetId) {
      return null;
    }

    const rulePreset = await options.sessionStore.getPolishRulePreset(rulePresetId);
    if (!rulePreset?.body) {
      return null;
    }

    state.rulePreset = rulePreset;
    state.dictionaryEntries = await options.sessionStore.listDictionaryEntries();
    return { rulePreset, dictionaryEntries: state.dictionaryEntries };
  };

  const recordChunkUsage = async (sessionId: string, result: PolishChunkResult) => {
    await options.sessionStore.createProviderUsageEvent(
      toProviderUsageEvent({
        sessionId,
        operationKind: 'inference',
        // A chunk call has no transcript and no output row of its own, so it is related to the
        // session directly. The dashboard sums these by session, and a rerun deletes them by
        // session.
        relatedEntityKind: 'polish_chunk',
        relatedEntityId: sessionId,
        provider: result.provider,
        model: result.model,
        usage: result.usage,
        providerRequestId: result.providerRequestId,
        providerResponseJson: result.providerResponseJson,
        createdAt: Date.now(),
      }),
    );
  };

  /**
   * Polish everything pending as one call.
   *
   * Always taking all pending text is what makes backlog merging fall out for free: a burst of
   * late-arriving batches collapses into one call instead of queueing one call per chunk, which the
   * replay showed would make a stalled session worse than single-shot.
   */
  const runChunk = async (
    sessionId: string,
    state: SessionPolishState,
    chunkOptions: { isFinal: boolean; signal?: AbortSignal },
  ) => {
    const rules = await resolvePinnedRules(state);
    if (!rules) {
      poison(state);
      return;
    }

    const transcript = pendingText(state);
    state.pendingTexts = [];
    const isFirstChunk = state.polishedChunkCount === 0;
    const abortController = new AbortController();
    state.abortControllers.add(abortController);
    const externalSignal = chunkOptions.signal;
    const abortFromExternal = () => abortController.abort();
    externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
    if (externalSignal?.aborted) {
      abortController.abort();
    }

    try {
      const result = await options.polish.polishChunk({
        sessionId,
        rulePreset: rules.rulePreset,
        dictionaryEntries: rules.dictionaryEntries,
        context: isFirstChunk ? '' : selectContextWindow(state.frozen),
        tail: isFirstChunk ? '' : state.tail,
        transcript,
        isFirstChunk,
        isFinal: chunkOptions.isFinal,
        signal: abortController.signal,
      });

      await recordChunkUsage(sessionId, result);

      // The call re-emits the tail, so its output replaces the tail rather than appending to it.
      state.document = state.frozen ? `${state.frozen}\n\n${result.text}` : result.text;
      const split = splitRewritableTail(state.document);
      state.frozen = split.frozen;
      state.tail = split.tail;
      state.polishedChunkCount += 1;
      state.lastCall = {
        provider: result.provider,
        model: result.model,
        providerRequestId: result.providerRequestId,
        providerResponseJson: result.providerResponseJson,
        rulePresetId: result.rulePresetId,
        rulePresetHash: result.rulePresetHash,
      };
    } catch (error) {
      // A late retry would have to be re-ordered against everything accumulated since, which is more
      // complexity than falling back is worth. The session takes today's latency instead (D7).
      console.error('Toph incremental polish chunk failed; falling back to single-shot.', error);
      poison(state);
    } finally {
      externalSignal?.removeEventListener('abort', abortFromExternal);
      state.abortControllers.delete(abortController);
    }
  };

  const readyToStartChunk = (state: SessionPolishState) =>
    !state.poisoned &&
    !state.closed &&
    polishIsEnabled() &&
    pendingText(state).length >= chunkCloseThresholdChars;

  /**
   * Start polishing if a chunk is due and nothing is in flight, then keep going while more is due.
   *
   * The loop matters as much as the entry condition: batches that arrive while a call is running are
   * accumulated by their own notifications but cannot start anything, so without it the text spoken
   * during the last call would wait for a batch that may never come, and land on the stop wait.
   */
  const startChunkIfReady = (sessionId: string, state: SessionPolishState) => {
    if (state.inFlight || !readyToStartChunk(state)) {
      return;
    }

    const task = (async () => {
      while (readyToStartChunk(state)) {
        await runChunk(sessionId, state, { isFinal: false });
      }
    })().finally(() => {
      if (state.inFlight === task) {
        state.inFlight = null;
      }
    });
    state.inFlight = task;
  };

  const settleInFlight = async (state: SessionPolishState) => {
    while (state.inFlight) {
      await state.inFlight.catch(() => {});
    }
  };

  const fallbackToSingleShot = (input: {
    sessionId: string;
    rawOutput: { id: string; text: string };
    outputId?: string;
    signal?: AbortSignal;
  }) =>
    options.polish.polishOutput({
      sessionId: input.sessionId,
      rawOutput: input.rawOutput,
      outputId: input.outputId,
      signal: input.signal,
    });

  return {
    beginSession(sessionId) {
      const previous = sessions.get(sessionId);
      if (previous) {
        // Session ids are unique, so this should be unreachable; leaving work running against a
        // state nothing can reach any more would be the worse way to find out otherwise.
        sessions.delete(sessionId);
        previous.closed = true;
        abortSession(previous);
      }

      if (!polishIsEnabled()) {
        return;
      }

      sessions.set(sessionId, createSessionPolishState());
    },

    async onBatchTranscribed(batch) {
      const state = sessions.get(batch.sessionId);
      if (!state || state.poisoned) {
        return;
      }

      await enqueue(state, async () => {
        if (state.poisoned || state.closed) {
          return;
        }

        await consumeTranscribedBatches(batch.sessionId, state);
        startChunkIfReady(batch.sessionId, state);
      });
    },

    async waitForSession(sessionId) {
      const state = sessions.get(sessionId);
      if (!state) {
        return;
      }

      // Both sides can feed each other: a queued notification starts a chunk, and a finished chunk
      // leaves accumulation that a queued notification has not seen yet. Settle until neither moved.
      let settledQueue: Promise<void> | null = null;
      while (state.queue !== settledQueue || state.inFlight) {
        settledQueue = state.queue;
        await state.queue.catch(() => {});
        await settleInFlight(state);
      }
    },

    async finalizeSession(input) {
      const state = sessions.get(input.sessionId);
      if (!state) {
        return fallbackToSingleShot(input);
      }

      // Never abort the in-flight chunk: its output is the tail the final call needs, and
      // re-polishing that text would cost more than waiting for it.
      state.closed = true;
      await state.queue.catch(() => {});
      await settleInFlight(state);

      const remainingTranscripts = state.poisoned
        ? []
        : await consumeTranscribedBatches(input.sessionId, state);
      const unreachableTranscripts = remainingTranscripts.filter(
        (transcript) => transcript.sequence >= state.nextSequence,
      );

      if (state.poisoned || state.polishedChunkCount === 0 || unreachableTranscripts.length > 0) {
        // A transcript still sitting behind a gap would be silently missing from the stitched
        // document, so a gap that survives to stop is a fallback, not a partial output.
        sessions.delete(input.sessionId);
        return fallbackToSingleShot(input);
      }

      if (pendingText(state).length > 0) {
        await runChunk(input.sessionId, state, { isFinal: true, signal: input.signal });
      }

      if (state.poisoned || !state.lastCall || !state.document.trim()) {
        sessions.delete(input.sessionId);
        return fallbackToSingleShot(input);
      }

      const lastCall = state.lastCall;
      const text = state.document;
      sessions.delete(input.sessionId);

      return options.outputs.createPolishedOutput({
        sessionId: input.sessionId,
        outputId: input.outputId,
        sourceOutputId: input.rawOutput.id,
        text,
        provider: lastCall.provider,
        model: lastCall.model,
        // Cost is already recorded, one `polish_chunk` event per call. An event here would
        // double-count the last one.
        usage: null,
        providerRequestId: lastCall.providerRequestId,
        providerResponseJson: lastCall.providerResponseJson,
        rulePresetId: lastCall.rulePresetId,
        rulePresetHash: lastCall.rulePresetHash,
      });
    },

    async cancelSession(sessionId) {
      const state = sessions.get(sessionId);
      if (!state) {
        return;
      }

      sessions.delete(sessionId);
      state.closed = true;
      abortSession(state);
      await state.queue.catch(() => {});
      await settleInFlight(state);
    },

    async dispose() {
      const states = Array.from(sessions.values());
      sessions.clear();
      for (const state of states) {
        state.closed = true;
        abortSession(state);
      }

      await Promise.allSettled(states.map((state) => settleInFlight(state)));
    },
  };
}
