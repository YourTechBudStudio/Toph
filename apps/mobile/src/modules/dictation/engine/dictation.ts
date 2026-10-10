import { createId, type PlannedBatchSourceRange } from '@toph/dictation-core';

import type { FramesEvent, SourceRange, TophVoice } from '../../../../modules/toph-voice';
// Type-only, so node tests load this file without the database or any Expo module.
import type { SessionRecords } from '../../history';
import type { PolishSources } from '../../polish';
import type { ProviderConfig } from '../../provider';
import { createRunPolish } from './polish';
import { createSegmentationRun } from './segmentation';
import { createTranscription, type DictationOutcome } from './transcription';

/**
 * One recording in progress. The caller calls exactly one of `stop` and `discard`, once. The
 * keyboard's dictation task (`keyboard/dictation-task.ts`) relies on this contract too.
 */
export interface DictationRun {
  /**
   * Ends recording, saves the run to history and returns the outcome: the selected text (polished
   * when polish ran, raw otherwise). Settles only after the mic, subscription, uploads, polish calls
   * and files are released. Never rejects.
   */
  stop(options?: StopOptions): Promise<DictationOutcome>;
  /** Ends recording and drops everything. Settles only after the same resources are released. Never rejects. */
  discard(): Promise<void>;
}

export interface StopOptions {
  /**
   * Called once, just before the final polish, when transcription has ended and only polish is left.
   * Not called when polish is off or the run has no transcript. A throw is logged and ignored.
   */
  onPolishing?: (() => void) | undefined;
}

/**
 * What the engine needs from the device: exactly the collaborators whose timing matters. The real
 * one is `nativeDictationHost`; tests pass fakes. It is a parameter rather than an import only so
 * this file loads under `node --test`.
 */
export interface DictationHost {
  voice: Pick<typeof TophVoice, 'addListener' | 'startCapture' | 'stopCapture' | 'cutBatch'>;
  /** Creates the session's folder under the app's documents (throws if it cannot) and names its files. */
  createSessionFolder(sessionId: string): SessionFolder;
  /** History's persistence. Every method may reject; the engine decides what a rejection means. */
  records: SessionRecords;
  /** Polish settings, rules and dictionary, from the polish module. */
  polish: PolishSources;
}

export interface SessionFolder {
  rawWavUri: string;
  /** `recordings/<sessionId>/raw.wav`, relative to the app's documents, as stored in the row. */
  relativeRawAudioPath: string;
  /** `batches/batch-NNNN.wav`, NNNN = sequence + 1 (desktop's naming). */
  batchUri(sequence: number): string;
  readBytes(uri: string): Promise<Uint8Array<ArrayBuffer>>;
  /** Deletes `batches/` and keeps raw.wav. Never throws (logs a warning). */
  deleteBatches(): void;
  /** Deletes the folder and everything in it. Never throws (logs a warning). */
  delete(): void;
}

/** A readable message for anything thrown. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error.';
}

const STILL_FINISHING = 'Another dictation is still finishing.';

/**
 * Lets one dictation hold the device at a time. The engine's frames listener hears every capture's
 * events, and native frees the mic before the previous run's final event has necessarily reached JS,
 * so overlapping runs would read each other's events. A run is held from the start call until its
 * start rejects or its `stop()`/`discard()` settles. Any start meanwhile rejects with
 * "Another dictation is still finishing." before taking anything.
 */
export function oneDictationAtATime(
  start: (config: ProviderConfig) => Promise<DictationRun>,
): (config: ProviderConfig) => Promise<DictationRun> {
  let held = false;
  return async (config) => {
    if (held) {
      throw new Error(STILL_FINISHING);
    }
    held = true;
    let run: DictationRun;
    try {
      run = await start(config);
    } catch (error) {
      held = false; // the engine has already released everything it took
      throw error;
    }
    // The engine's "exactly one of stop and discard, once" rule means this releases once.
    return {
      async stop(options) {
        try {
          return await run.stop(options);
        } finally {
          held = false;
        }
      },
      async discard() {
        try {
          await run.discard();
        } finally {
          held = false;
        }
      },
    };
  };
}

const toSourceRange = (range: PlannedBatchSourceRange): SourceRange => ({
  startMs: range.sourceStartMs,
  endMs: range.sourceEndMs,
});

/** Runs a step whose failure must not change the outcome, and logs that failure. Never rejects. */
async function logged(what: string, step: () => Promise<unknown>): Promise<void> {
  try {
    await step();
  } catch (error) {
    console.warn(`[toph:dictation] ${what} failed`, error);
  }
}

/** Calls `onPolishing`; a throw is logged and never changes the outcome. */
function notifyPolishing(options: StopOptions | undefined): void {
  try {
    options?.onPolishing?.();
  } catch (error) {
    console.warn('[toph:dictation] onPolishing failed', error);
  }
}

/**
 * Starts recording, as desktop does: the session row and folder exist before the mic opens.
 * Rejects (after releasing everything it took) if the database or polish storage is unusable, the
 * row cannot be written, or capture cannot start.
 *
 * Native frames are segmented with desktop's order; each planned batch is cut from raw.wav and
 * handed to the core's coordinator, which uploads it at once, and each transcribed batch is offered
 * to the core's incremental polish. Stopping runs desktop's end of run: mark recorded, wait for
 * every upload, write the raw output, polish when polish is on, select the final text, then
 * delete `batches/` and prune history to the newest sessions.
 */
export async function startDictation(
  config: ProviderConfig,
  host: DictationHost,
): Promise<DictationRun> {
  const { voice, records } = host;
  await records.ready(); // the database is unusable: nothing has been taken yet
  await host.polish.ready(); // polish storage is unusable: nothing has been taken yet
  const sessionId = createId('session');
  const startedAt = Date.now();
  const folder = host.createSessionFolder(sessionId); // if this throws, nothing has been taken yet
  try {
    await records.createRecordingSession({
      id: sessionId,
      startedAt,
      rawAudioPath: folder.relativeRawAudioPath,
      transcriptionModel: config.transcriptionModel,
    });
  } catch (error) {
    folder.delete(); // the start is refused before the mic opens
    throw error;
  }

  let stage: 'recording' | 'stopping' = 'recording';
  const log = (message: string) => {
    console.log('[toph:dictation]', `+${Date.now() - startedAt}ms`, stage, message);
  };

  const segmentation = createSegmentationRun(sessionId);
  const transcription = createTranscription({
    sessionId,
    config,
    log,
    readBatchAudio: (uri) => folder.readBytes(uri),
    onBatchTranscribed: (batch) => polish.onBatchTranscribed(batch),
  });
  const polish = createRunPolish({
    sessionId,
    config,
    sources: host.polish,
    records,
    transcripts: transcription,
  });
  polish.begin(); // registers incremental work only if polish is on now

  let firstError: string | null = null; // the run fails with this, if set
  let discarded = false;
  /** The end of the last scored frame, in samples at 16 kHz: the recording's audio length. */
  let lastEndSample = 0;
  let chain = Promise.resolve(); // events are handled one at a time, in arrival order
  let captureEnded = () => {};
  const ended = new Promise<void>((resolve) => {
    captureEnded = resolve;
  });

  // Nothing new is scheduled after a discard or an error. Checked again after every cut, because
  // Discard can arrive while a cut is in flight.
  const halted = () => discarded || firstError !== null;

  const handle = async (event: FramesEvent) => {
    if (event.error !== null) {
      firstError ??= `Recording failed: ${event.error}`;
    }
    if (halted()) {
      return;
    }
    const batches = event.final ? segmentation.finish(event) : segmentation.push(event);
    for (const batch of batches) {
      const audioUri = folder.batchUri(batch.sequence);
      await voice.cutBatch(folder.rawWavUri, batch.sourceRanges.map(toSourceRange), audioUri);
      if (halted()) {
        return;
      }
      log(`batch ${batch.sequence + 1} planned (${batch.derivedAudioDurationMs}ms of audio)`);
      await transcription.addBatch(batch, audioUri);
    }
  };

  // Added before capture starts, so no event is missed.
  const subscription = voice.addListener('onFrames', (event) => {
    for (const endSample of event.endSamples) {
      lastEndSample = Math.max(lastEndSample, endSample);
    }
    chain = chain
      .then(() => handle(event))
      .catch((error: unknown) => {
        firstError ??= describeError(error);
      })
      .then(() => {
        if (event.final) {
          captureEnded();
        }
      });
  });

  try {
    await voice.startCapture(folder.rawWavUri);
  } catch (error) {
    // Released in discard's order; the row is kept as `cancelled`, as desktop's cancelStartedSession does.
    subscription.remove();
    await logged('cancel transcription', () => transcription.cancel());
    await logged('settle polish', () => polish.settle());
    folder.delete();
    await logged('mark cancelled', () => records.markCancelled(sessionId));
    throw error;
  }
  log('recording started');

  // Resolves once the final event has been handled: every batch is cut and scheduled. Waits for the
  // event itself, not for `stopCapture`, whose promise may settle before the event is delivered.
  const endCapture = async () => {
    stage = 'stopping';
    log('stop');
    try {
      await voice.stopCapture();
      await ended;
    } finally {
      subscription.remove(); // also if stopCapture broke its never-reject contract
    }
  };

  return {
    async stop(options) {
      let outcome: DictationOutcome;
      // Guards the catch below, so transcription is cancelled at most once and never after `finish`.
      let transcriptionEnded = false;

      // Every write here is required: a rejection fails the dictation and withholds its text.
      const settleOutcome = async (): Promise<DictationOutcome> => {
        if (firstError !== null) {
          const message = firstError;
          transcriptionEnded = true;
          await transcription.cancel();
          await records.markFailed({ sessionId, errorMessage: message });
          return { kind: 'failed', message };
        }
        transcriptionEnded = true;
        const result = await transcription.finish(); // waits for every upload, then disposes
        if (result.kind === 'no_speech') {
          await records.markNoSpeech(sessionId);
          return result;
        }
        if (result.kind === 'failed') {
          await records.markFailed({ sessionId, errorMessage: result.message });
          return result;
        }
        const raw = await polish.outputs.createRawConcatOutput(sessionId);
        if (!polish.isEnabled()) {
          await polish.outputs.selectOutput({ sessionId, outputId: raw.id });
          return { kind: 'transcript', text: raw.text };
        }
        notifyPolishing(options);
        try {
          // Writing or selecting the polished output counts as polish, as desktop groups it.
          const polished = await polish.finish(raw);
          await polish.outputs.selectOutput({ sessionId, outputId: polished.id });
          return { kind: 'transcript', text: polished.text };
        } catch (error) {
          // No trailing period, so splitErrorDetail can still separate a JSON body at the end.
          const message = `Polish failed unexpectedly. Raw text saved in Toph history. ${describeError(error)}`;
          await records.markFailed({ sessionId, errorMessage: message });
          return { kind: 'failed', message };
        }
      };

      try {
        try {
          await endCapture();
        } catch (error) {
          // stopCapture broke its contract; the subscription is already removed.
          firstError ??= describeError(error);
        }
        await records.markRecorded({
          sessionId,
          endedAt: Date.now(),
          durationMs: Math.round(lastEndSample / 16),
        });
        outcome = await settleOutcome();
      } catch (error) {
        // A required write threw.
        if (!transcriptionEnded) {
          transcriptionEnded = true;
          await logged('cancel transcription', () => transcription.cancel());
        }
        const message = `Couldn't save this dictation. ${describeError(error)}`;
        outcome = { kind: 'failed', message };
        await logged('mark failed', () => records.markFailed({ sessionId, errorMessage: message }));
      } finally {
        // Ancillary: the outcome is committed, so each step is only logged.
        await logged('settle polish', () => polish.settle()); // aborts and awaits any running chunk
        folder.deleteBatches();
        await logged('prune history', () => records.pruneAndRefresh());
      }
      return outcome;
    },

    async discard() {
      discarded = true;
      await logged('discard: end capture', endCapture);
      await logged('discard: cancel transcription', () => transcription.cancel());
      await logged('discard: settle polish', () => polish.settle());
      folder.delete();
      await logged('discard: mark cancelled', () => records.markCancelled(sessionId));
    },
  };
}
