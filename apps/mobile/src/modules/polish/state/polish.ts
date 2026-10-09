import { openDatabase } from '../../../storage/database';
import { readSecureJson, writeSecureJson } from '../../../storage/secure-json';
import { createPolishStore, parseStoredPolishSettings } from './polish-store';
import { createPolishTables } from './polish-tables';

const POLISH_SETTINGS_KEY = 'toph.polish.settings';
const LOG_TAG = '[toph:polish]';

const polish = createPolishStore({
  openTables: async () => createPolishTables(await openDatabase()),
  readSettings: () => readSecureJson(POLISH_SETTINGS_KEY, parseStoredPolishSettings, LOG_TAG),
  saveSettings: (read) => writeSecureJson(POLISH_SETTINGS_KEY, read, LOG_TAG),
});

/** Module-private: screens in this module read it; other modules use the hooks and sources below. */
export const usePolishStore = polish.usePolishStore;
/** Reads the saved polish settings and lists once per JS runtime. Never rejects. */
export const loadPolish = polish.loadPolish;
/** What the dictation engine reads; safe outside React, including the keyboard's task. */
export const polishSources = polish.polishSources;

/** Whether the saved polish settings have been read, so onboarding never decides from defaults. */
export function usePolishLoaded(): boolean {
  return usePolishStore((state) => state.loaded);
}

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

/** A preset's title for history, or null when the preset no longer exists. */
export function usePresetTitle(id: string | null): string | null {
  return usePolishStore((state) => state.presets.find((preset) => preset.id === id)?.title ?? null);
}
