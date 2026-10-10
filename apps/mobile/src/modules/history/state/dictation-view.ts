import type { RecordingSession, SessionOutput } from '@toph/dictation-core';

/** What history shows a session as. Every retainable status other than these two is `failed`. */
export type DictationStatus = 'done' | 'no_speech' | 'failed';

/** One retained session as history shows it. */
export interface Dictation {
  readonly id: string;
  readonly createdAt: number;
  /** Null when the recording never finished. Desktop's column is nullable. */
  readonly durationMs: number | null;
  readonly status: DictationStatus;
  readonly errorMessage: string | null;
  /** The raw transcript, when one was assembled. */
  readonly raw: string | null;
  /** The selected polished text; null when polish was off or failed (see `status`). */
  readonly polished: string | null;
  /** The preset that produced `polished`. */
  readonly rulePresetId: string | null;
}

const toStatus = (status: RecordingSession['status']): DictationStatus => {
  switch (status) {
    case 'completed':
      return 'done';
    case 'no_speech':
      return 'no_speech';
    default:
      // `failed`, `recording_failed`, and `recorded`/`segmented` from a run that never finished.
      return 'failed';
  }
};

/** One retained session and its outputs → what history shows. Pure, so it runs under `node --test`. */
export function toDictation(
  session: RecordingSession,
  outputs: readonly SessionOutput[],
): Dictation {
  const raw = outputs.find((output) => output.kind === 'raw_concat') ?? null;
  const selected = outputs.find((output) => output.id === session.selectedOutputId) ?? null;
  const polished = selected?.kind === 'polished' ? selected : null;
  return {
    id: session.id,
    createdAt: session.createdAt,
    durationMs: session.durationMs,
    status: toStatus(session.status),
    errorMessage: session.errorMessage,
    raw: raw?.text ?? null,
    polished: polished?.text ?? null,
    rulePresetId: polished?.rulePresetId ?? null,
  };
}

/** What stands in for a dictation's text when it has none: shown by the row and the detail's status card. */
export function dictationFallbackText(dictation: Pick<Dictation, 'status'>): string {
  return dictation.status === 'no_speech' ? 'No speech came through.' : "This one didn't finish.";
}
