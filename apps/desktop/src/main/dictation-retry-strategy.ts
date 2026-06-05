import type { AppSettings } from '@toph/desktop-contracts';

import type { RecordingSession, TranscriptionBatch } from './db/schema';

export type DictationRetryStrategy =
  | { kind: 'full-rerun' }
  | { kind: 'retry-failed-transcription-batches'; batchIds: string[] }
  | { kind: 'regenerate-output-from-existing-transcripts' }
  | { kind: 'not-retryable'; reason: string };

function hasUsableTranscriptionSnapshot(
  session: Pick<RecordingSession, 'transcriptionProviderId' | 'transcriptionModel'>,
) {
  return Boolean(session.transcriptionProviderId && session.transcriptionModel);
}

function transcriptionSnapshotMatchesCurrentSettings(
  session: Pick<RecordingSession, 'transcriptionProviderId' | 'transcriptionModel'>,
  settings: Pick<AppSettings, 'transcription'>,
) {
  return (
    session.transcriptionProviderId === settings.transcription.providerId &&
    session.transcriptionModel === settings.transcription.model
  );
}

export function resolveDictationRetryStrategy(input: {
  session: Pick<RecordingSession, 'status' | 'transcriptionProviderId' | 'transcriptionModel'>;
  batches: Array<Pick<TranscriptionBatch, 'id' | 'status' | 'derivedAudioPath'>>;
  settings: Pick<AppSettings, 'transcription'>;
  batchAudioExists: (path: string) => boolean;
}): DictationRetryStrategy {
  if (input.session.status === 'removed' || input.session.status === 'cancelled') {
    return { kind: 'not-retryable', reason: 'Session no longer has retained audio.' };
  }

  if (input.session.status === 'recording') {
    return { kind: 'not-retryable', reason: 'Session is still recording.' };
  }

  if (
    !hasUsableTranscriptionSnapshot(input.session) ||
    !transcriptionSnapshotMatchesCurrentSettings(input.session, input.settings)
  ) {
    return { kind: 'full-rerun' };
  }

  const incompleteBatches = input.batches.filter((batch) => batch.status !== 'transcribed');
  if (incompleteBatches.length > 0) {
    const canRetryIncompleteBatches = incompleteBatches.every(
      (batch) => batch.derivedAudioPath && input.batchAudioExists(batch.derivedAudioPath),
    );
    if (!canRetryIncompleteBatches) {
      return { kind: 'full-rerun' };
    }

    return {
      kind: 'retry-failed-transcription-batches',
      batchIds: incompleteBatches.map((batch) => batch.id),
    };
  }

  if (input.batches.length > 0) {
    return { kind: 'regenerate-output-from-existing-transcripts' };
  }

  return { kind: 'full-rerun' };
}
