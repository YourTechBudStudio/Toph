import { create } from 'zustand';

import { builtInPresets, type RulePreset } from './presets';

export interface DictionaryEntry {
  readonly id: string;
  readonly term: string;
  readonly hint: string | null;
  readonly enabled: boolean;
}

export interface PresetDraft {
  readonly title: string;
  readonly description: string;
  readonly body: string;
}

interface PolishState {
  readonly enabled: boolean;
  /** Null until a writing style is chosen; onboarding asks for one before first use. */
  readonly activePresetId: string | null;
  readonly presets: readonly RulePreset[];
  readonly dictionary: readonly DictionaryEntry[];
  setEnabled(enabled: boolean): void;
  setActivePreset(id: string): void;
  updatePreset(id: string, draft: PresetDraft): void;
  addEntry(term: string, hint: string): void;
  setEntryEnabled(id: string, enabled: boolean): void;
  removeEntry(id: string): void;
}

/**
 * Polish settings, held in memory with mock content. Persistence and the real polish pipeline
 * arrive with the polish and history story; the shape follows desktop's settings.
 */
export const usePolishStore = create<PolishState>()((set) => ({
  enabled: true,
  activePresetId: null,
  presets: builtInPresets,
  dictionary: [
    {
      id: 'toph',
      term: 'Toph',
      hint: 'Proper noun. The app I am building. Sounds like "toff".',
      enabled: true,
    },
    {
      id: 'expo',
      term: 'Expo',
      hint: 'The React Native framework, not a trade show.',
      enabled: true,
    },
    { id: 'jwt', term: 'JWT', hint: 'Preserve capitalization as "JWT".', enabled: true },
    {
      id: 'kubectl',
      term: 'kubectl',
      hint: 'Sounds like "cube control". Lowercase.',
      enabled: false,
    },
  ],
  setEnabled: (enabled) => set({ enabled }),
  setActivePreset: (activePresetId) => set({ activePresetId }),
  updatePreset: (id, draft) =>
    set(({ presets }) => ({
      presets: presets.map((preset) => (preset.id === id ? { ...preset, ...draft } : preset)),
    })),
  addEntry: (term, hint) =>
    set(({ dictionary }) => ({
      dictionary: [
        {
          id: `${term.toLowerCase()}-${String(Date.now())}`,
          term,
          hint: hint.trim() === '' ? null : hint,
          enabled: true,
        },
        ...dictionary,
      ],
    })),
  setEntryEnabled: (id, enabled) =>
    set(({ dictionary }) => ({
      dictionary: dictionary.map((entry) => (entry.id === id ? { ...entry, enabled } : entry)),
    })),
  removeEntry: (id) =>
    set(({ dictionary }) => ({ dictionary: dictionary.filter((entry) => entry.id !== id) })),
}));

/** Whether a writing style is chosen, which onboarding requires even if polish is later off. */
export function usePresetChosen(): boolean {
  return usePolishStore(
    (state) => state.presets.find((preset) => preset.id === state.activePresetId) !== undefined,
  );
}

/** The one-line summary the settings hub shows for polish. */
export function usePolishSummary(): { enabled: boolean; presetTitle: string; activeTerms: number } {
  const enabled = usePolishStore((state) => state.enabled);
  const presetTitle = usePolishStore(
    (state) => state.presets.find((preset) => preset.id === state.activePresetId)?.title ?? 'None',
  );
  const activeTerms = usePolishStore(
    (state) => state.dictionary.filter((entry) => entry.enabled).length,
  );
  return { enabled, presetTitle, activeTerms };
}
