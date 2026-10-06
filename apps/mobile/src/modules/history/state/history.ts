import { create } from 'zustand';

export type DictationSource = 'app' | 'keyboard';

export interface Dictation {
  readonly id: string;
  readonly createdAt: number;
  readonly durationMs: number;
  readonly source: DictationSource;
  readonly raw: string;
  /** The polished text, or null when polish was off for this dictation. */
  readonly polished: string | null;
  readonly presetTitle: string | null;
}

const MINUTE = 60_000;
const loadedAt = Date.now();

const mockDictations: readonly Dictation[] = [
  {
    id: 'd-1006',
    createdAt: loadedAt - 4 * MINUTE,
    durationMs: 23_400,
    source: 'keyboard',
    raw: "okay so the flaky test is uh the one in the segmentation suite it only fails on CI because the the timer mock isn't reset between cases can you add a before each that resets it",
    polished:
      "The flaky test is in the segmentation suite. It only fails on CI because the timer mock isn't reset between cases. Can you add a `beforeEach` that resets it?",
    presetTitle: 'Engineer',
  },
  {
    id: 'd-1005',
    createdAt: loadedAt - 47 * MINUTE,
    durationMs: 41_900,
    source: 'keyboard',
    raw: 'hey priya thanks for the review um i addressed all the comments except the one about caching i think we should invalidate on write not on read but happy to chat about it tomorrow',
    polished:
      "Hey Priya, thanks for the review! I addressed all the comments except the one about caching. I think we should invalidate on write, not on read, but I'm happy to chat about it tomorrow.",
    presetTitle: 'Email & Writing',
  },
  {
    id: 'd-1004',
    createdAt: loadedAt - 3 * 60 * MINUTE,
    durationMs: 8_200,
    source: 'app',
    raw: 'remind me to rotate the staging api keys before friday',
    polished: null,
    presetTitle: null,
  },
  {
    id: 'd-1003',
    createdAt: loadedAt - 26 * 60 * MINUTE,
    durationMs: 57_300,
    source: 'keyboard',
    raw: 'so the plan for the mobile app is basically three things first the foundation with all the screens mocked then the shared dictation core so desktop and mobile run the exact same vad and chunking and then the keyboard itself which is the whole point',
    polished:
      'The plan for the mobile app has three parts:\n\n1. The foundation, with every screen mocked.\n2. The shared dictation core, so desktop and mobile run the exact same VAD and chunking.\n3. The keyboard itself, which is the whole point.',
    presetTitle: 'Engineer',
  },
  {
    id: 'd-1002',
    createdAt: loadedAt - 3 * 24 * 60 * MINUTE,
    durationMs: 15_600,
    source: 'app',
    raw: "it's not dns there's no way it's dns okay it was dns",
    polished: "It's not DNS. There's no way it's DNS. Okay, it was DNS.",
    presetTitle: 'General',
  },
];

interface HistoryState {
  readonly dictations: readonly Dictation[];
  add(dictation: Dictation): void;
}

/**
 * Past dictations, newest first, held in memory with mock content. SQLite persistence arrives
 * with the polish and history story.
 */
export const useHistoryStore = create<HistoryState>()((set) => ({
  dictations: mockDictations,
  add: (dictation) => set(({ dictations }) => ({ dictations: [dictation, ...dictations] })),
}));

/** Files a finished dictation at the top of history. */
export function recordDictation(dictation: Dictation): void {
  useHistoryStore.getState().add(dictation);
}

export function useDictation(id: string): Dictation | undefined {
  return useHistoryStore((state) => state.dictations.find((dictation) => dictation.id === id));
}
