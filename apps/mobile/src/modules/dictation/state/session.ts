import { create } from 'zustand';

import { recordDictation, type Dictation } from '../../history';
import { readPolishChoice } from '../../polish';

/**
 * Where an in-app dictation stands. `done` keeps the latest result on screen until the next
 * recording starts.
 */
export type DictationPhase = 'idle' | 'listening' | 'transcribing' | 'polishing' | 'done';

const TRANSCRIBE_MS = 1300;
const POLISH_MS = 1100;

/** Canned speech for the mock pipeline, raw and polished. */
const mockSpeech = [
  {
    raw: 'can we move the stand up to ten thirty my build is still running and i refuse to watch it alone',
    polished:
      'Can we move the stand-up to 10:30? My build is still running and I refuse to watch it alone.',
  },
  {
    raw: 'note to self the bug is not in the parser it was never in the parser stop opening the parser',
    polished:
      'Note to self: the bug is not in the parser. It was never in the parser. Stop opening the parser.',
  },
  {
    raw: 'ship the hotfix behind a feature flag and we will flip it after lunch not on friday evening',
    polished:
      "Ship the hotfix behind a feature flag, and we'll flip it after lunch. Not on Friday evening.",
  },
] as const;

interface SessionState {
  readonly phase: DictationPhase;
  readonly startedAt: number | null;
  readonly latest: Dictation | null;
  /** The preset polishing the current dictation, for the status line. */
  readonly polishingWith: string | null;
  start(): void;
  stop(): void;
  cancel(): void;
}

let pending: ReturnType<typeof setTimeout> | null = null;
let takes = 0;

function after(ms: number, step: () => void): void {
  pending = setTimeout(() => {
    pending = null;
    step();
  }, ms);
}

/**
 * The in-app dictation session, mocked: recording is a timer and the transcript is canned. The
 * phases and their order are the real ones, so in-app dictation swaps the insides, not the shape.
 */
export const useSessionStore = create<SessionState>()((set, get) => ({
  phase: 'idle',
  startedAt: null,
  latest: null,
  polishingWith: null,
  start: () => {
    const { phase } = get();
    if (phase !== 'idle' && phase !== 'done') {
      return;
    }
    set({ phase: 'listening', startedAt: Date.now(), polishingWith: null });
  },
  stop: () => {
    const { phase, startedAt } = get();
    if (phase !== 'listening' || startedAt === null) {
      return;
    }
    const durationMs = Date.now() - startedAt;
    const speech = mockSpeech[takes % mockSpeech.length] ?? mockSpeech[0];
    takes += 1;
    const polish = readPolishChoice();
    const preset = polish.enabled ? (polish.preset ?? null) : null;

    const finish = () => {
      const dictation: Dictation = {
        id: `d-live-${String(Date.now())}`,
        createdAt: Date.now(),
        durationMs,
        source: 'app',
        raw: speech.raw,
        polished: preset === null ? null : speech.polished,
        presetTitle: preset?.title ?? null,
      };
      recordDictation(dictation);
      set({ phase: 'done', startedAt: null, latest: dictation, polishingWith: null });
    };

    set({ phase: 'transcribing' });
    after(TRANSCRIBE_MS, () => {
      if (preset === null) {
        finish();
        return;
      }
      set({ phase: 'polishing', polishingWith: preset.title });
      after(POLISH_MS, finish);
    });
  },
  cancel: () => {
    if (pending !== null) {
      clearTimeout(pending);
      pending = null;
    }
    set({ phase: 'idle', startedAt: null, polishingWith: null });
  },
}));

export function useDictationPhase(): DictationPhase {
  return useSessionStore((state) => state.phase);
}
