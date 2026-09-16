import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

import { sanitizeErrorMessage } from '../history/error-report';

/**
 * Durable, always-on diagnostics for the live transcription handover path.
 *
 * This exists to settle why some batches created during recording are not transcribed until after
 * the session ends. See `scratch/plans/incremental-polish/phase-02-live-transcription-lag.md`. The
 * database cannot answer it: `markBatchTranscribing` and `markBatchTranscribed` both clear
 * `errorMessage`, and a retry overwrites `transcriptionAttempts`, so a batch that failed live and
 * succeeded later is indistinguishable after the fact from one that was never submitted.
 *
 * The recorded events are deliberately narrow. Every event carries ids, an event name and a
 * timestamp. No transcript text and no filesystem paths are written; the one free-text field
 * (`message`) is routed through `sanitizeErrorMessage` before it reaches disk.
 */
export type TranscriptionDiagnosticEvent =
  /** The segmentation pipeline handed a set of batches to the transcription coordinator. */
  | { kind: 'batches_handed_over'; sessionId: string; batchIds: string[]; origin: HandoverOrigin }
  /** `onBatchReady` was entered for a batch. */
  | { kind: 'batch_received'; batchId: string; resetAttempts: boolean }
  /** `onBatchReady` returned without creating a task. */
  | { kind: 'batch_skipped'; batchId: string; reason: BatchSkipReason }
  /**
   * The transcription task body was entered. An async function body runs synchronously up to its
   * first `await` and `record` never returns a promise, so this always lands in the same tick as
   * the `batch_received` that precedes it. It records that a task was *created*, not that the task
   * made progress — read `batch_session_loaded` for that.
   */
  | { kind: 'batch_task_created'; sessionId: string; batchId: string }
  /**
   * The `getSession` read inside `transcribeBatch` resolved. This is the only `await` between task
   * creation and the first attempt; everything after it up to the attempt loop is synchronous. So
   * the gap either side of this event says directly whether a stall sits inside the store read or
   * before the attempt loop, rather than leaving it to be inferred from an absence.
   */
  | { kind: 'batch_session_loaded'; sessionId: string; batchId: string }
  /** The task body returned, whether by success, failure or abort. */
  | { kind: 'batch_task_settled'; sessionId: string; batchId: string }
  | { kind: 'batch_attempt_started'; sessionId: string; batchId: string; attempt: number }
  | {
      kind: 'batch_attempt_succeeded';
      sessionId: string;
      batchId: string;
      attempt: number;
      providerDurationMs: number;
    }
  | {
      kind: 'batch_attempt_failed';
      sessionId: string;
      batchId: string;
      attempt: number;
      transient: boolean;
      message: string;
    }
  | {
      kind: 'batch_failed';
      sessionId: string;
      batchId: string;
      attempts: number;
      message: string;
    };

export type HandoverOrigin = 'live' | 'recorded_rerun' | 'partial_retry';

export type BatchSkipReason = 'already_tracked' | 'missing_row' | 'already_transcribed';

export interface TranscriptionDiagnostics {
  /**
   * Records one event. Never throws and never returns a promise, so a diagnostic can never reject
   * into a transcription task or stall the live processing queue.
   */
  record: (event: TranscriptionDiagnosticEvent) => void;
  /**
   * Resolves once every queued write has settled. Called during quit cleanup, after transcription
   * disposal, so events emitted while tearing down in-flight batches are not lost.
   */
  flush: () => Promise<void>;
}

/** Roughly a month of this user's batch volume before the previous window is rolled off. */
const defaultMaxBytes = 2_000_000;

/**
 * Failure messages carry whatever the provider returned, and the ChatGPT backend answers a
 * transient 403 with a ~2 KB HTML page. Left whole, four such failures took 41% of the file on the
 * trail's first real run, which would roll the window off long before the rare event this log
 * exists to capture. The diagnostic value is in the first line - the status code and the reason -
 * so the rest is dropped and the dropped length is kept as its own signal.
 */
const maxMessageLength = 500;

function truncateMessage(message: string) {
  if (message.length <= maxMessageLength) {
    return message;
  }

  return `${message.slice(0, maxMessageLength)}… (+${message.length - maxMessageLength} chars)`;
}

function sanitizeEvent(event: TranscriptionDiagnosticEvent, sensitiveRoots: string[]) {
  if ('message' in event) {
    // Redact first, then truncate, so a path near the cut cannot survive by being split.
    return {
      ...event,
      message: truncateMessage(sanitizeErrorMessage(event.message, sensitiveRoots)),
    };
  }

  return event;
}

export function createTranscriptionDiagnostics(options: {
  filePath: string;
  /** Directories to redact out of any message text, as `buildSessionErrorReport` does. */
  sensitiveRoots: string[];
  maxBytes?: number;
  now?: () => number;
}): TranscriptionDiagnostics {
  const maxBytes = options.maxBytes ?? defaultMaxBytes;
  const now = options.now ?? Date.now;
  const previousFilePath = `${options.filePath}.1`;
  let queue: Promise<void> = Promise.resolve();
  let reportedFailure = false;

  const rotateIfOversized = async () => {
    let size: number;
    try {
      size = (await stat(options.filePath)).size;
    } catch {
      return;
    }

    if (size < maxBytes) {
      return;
    }

    await rename(options.filePath, previousFilePath);
  };

  const write = async (line: string) => {
    await mkdir(dirname(options.filePath), { recursive: true });
    await rotateIfOversized();
    await appendFile(options.filePath, line, 'utf8');
  };

  const reportFailure = (error: unknown) => {
    if (reportedFailure) {
      return;
    }

    reportedFailure = true;
    console.error('Toph could not write transcription diagnostics.', error);
  };

  return {
    record(event) {
      // The timestamp and the redaction are taken here, synchronously, and only the write is
      // queued. Stamping inside the queued write would record when the line reached the
      // filesystem, which shifts with pending writes and with any suspension of the main process
      // - and a suspended main process is one of the surviving explanations for the lag this
      // trail exists to attribute. The recorded gaps have to be gaps between events, not between
      // disk writes.
      let line: string;
      try {
        line = `${JSON.stringify({
          at: now(),
          ...sanitizeEvent(event, options.sensitiveRoots),
        })}\n`;
      } catch (error) {
        reportFailure(error);
        return;
      }

      queue = queue.then(async () => {
        try {
          await write(line);
        } catch (error) {
          reportFailure(error);
        }
      });
    },

    async flush() {
      await queue;
    },
  };
}
