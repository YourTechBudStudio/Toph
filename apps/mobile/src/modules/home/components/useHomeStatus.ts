import type { Tone } from '../../../ui';
import { useDictationPhase } from '../../dictation';

export interface HomeStatus {
  readonly label: string;
  readonly tone: Tone;
  readonly live: boolean;
}

/**
 * What dictation is doing right now. Missing setup never shows here: onboarding covers the app
 * until every prerequisite is met.
 */
export function useHomeStatus(): HomeStatus {
  switch (useDictationPhase()) {
    case 'listening':
      return { label: 'Listening', tone: 'red', live: true };
    case 'transcribing':
      return { label: 'Transcribing', tone: 'blue', live: true };
    case 'polishing':
      return { label: 'Polishing', tone: 'violet', live: true };
    case 'idle':
    case 'done':
      return { label: 'Ready', tone: 'green', live: false };
  }
}
