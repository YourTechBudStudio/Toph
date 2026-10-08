import type { PlannedBatchSourceRange } from '@toph/dictation-core';

import type { FramesEvent, SourceRange, TophVoice } from '../../../../modules/toph-voice';
import type { TranscriptionConfig } from '../../provider';
import { createSegmentationRun } from './segmentation';
import { createTranscription, type DictationOutcome } from './transcription';

/**
 * One recording in progress. The caller calls exactly one of `stop` and `discard`, once. The
 * keyboard's dictation task (`keyboard/dictation-task.ts`) relies on this contract too.
 */
export interface DictationRun {
  /** Ends recording and returns the outcome. Settles only after the mic, subscription, uploads and files are released. Never rejects. */
  stop(): Promise<DictationOutcome>;
  /** Ends recording and drops everything. Settles only after the same resources are released. Never rejects. */
  discard(): Promise<void>;
}

/**
 * What the engine needs from the device: exactly the collaborators whose timing matters. The real
 * one is `nativeDictationHost`; tests pass fakes. It is a parameter rather than an import only so
 * this file loads under `node --test`.
 */
export interface DictationHost {
  voice: Pick<typeof TophVoice, 'addListener' | 'startCapture' | 'stopCapture' | 'cutBatch'>;
  /** Creates the session's folder (throws if it cannot) and names the files in it. */
  createSessionFolder(sessionId: string): SessionFolder;
}

export interface SessionFolder {
  rawWavUri: string;
  /** `batches/batch-NNNN.wav`, NNNN = sequence + 1 (desktop's naming). */
  batchUri(sequence: number): string;
  readBytes(uri: string): Promise<Uint8Array<ArrayBuffer>>;
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
  start: (config: TranscriptionConfig) => Promise<DictationRun>,
): (config: TranscriptionConfig) => Promise<DictationRun> {
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
      async stop() {
        try {
          return await run.stop();
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

/**
 * Starts recording. Rejects (after releasing everything it took) if capture cannot start.
 *
 * Native frames are segmented with desktop's order; each planned batch is cut from raw.wav and
 * handed to the core's coordinator, which uploads it at once. Stopping waits for the native final
 * event, flushes, waits for every upload and joins the texts.
 */
export async function startDictation(
  config: TranscriptionConfig,
  host: DictationHost,
): Promise<DictationRun> {
  const { voice } = host;
  const sessionId = globalThis.crypto.randomUUID();
  const folder = host.createSessionFolder(sessionId); // if this throws, nothing has been taken yet
  const startedAt = Date.now();
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
  });

  let firstError: string | null = null; // the run fails with this, if set
  let discarded = false;
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
    subscription.remove();
    folder.delete();
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
    async stop() {
      try {
        try {
          await endCapture();
        } catch (error) {
          // stopCapture broke its contract; the subscription is already removed.
          firstError ??= describeError(error);
        }
        if (firstError !== null) {
          await transcription.cancel();
          return { kind: 'failed', message: firstError };
        }
        return await transcription.finish();
      } catch (error) {
        // `finish` or `cancel` already ran, so the other one is never called here.
        return { kind: 'failed', message: describeError(error) };
      } finally {
        folder.delete();
      }
    },

    async discard() {
      discarded = true;
      try {
        await endCapture();
      } catch (error) {
        console.warn('[toph:dictation] discard', error);
      }
      try {
        await transcription.cancel();
      } catch (error) {
        console.warn('[toph:dictation] discard', error);
      }
      folder.delete();
    },
  };
}
