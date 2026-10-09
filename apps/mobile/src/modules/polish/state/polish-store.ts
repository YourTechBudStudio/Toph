import { create, type StoreApi, type UseBoundStore } from 'zustand';

import {
  ensureDictionaryEnabledLimit,
  normalizeDictionaryEntryDraft,
  normalizeRulePresetDraft,
  seedDefaultDictionaryEntries,
  type DictionaryEntry,
  type PolishRulePreset,
  type PolishRulePresetDraft,
  type PolishRulesStore,
  type PolishSettingsReader,
} from '@toph/dictation-core';

// Type-only, so node tests load this file without the database or any Expo module.
import type { PolishTables } from './polish-tables';

/** The polish settings saved in SecureStore, shaped like desktop's `settings.polish`. */
export interface StoredPolishSettings {
  readonly enabled: boolean;
  readonly rulePresetId: string | null;
  readonly dictionaryDefaultsSeeded: boolean;
}

/** Desktop's `DEFAULT_APP_SETTINGS.polish`. */
export const defaultPolishSettings: StoredPolishSettings = {
  enabled: true,
  rulePresetId: null,
  dictionaryDefaultsSeeded: false,
};

/** The saved settings, or null when missing, not JSON, or the wrong shape. */
export function parseStoredPolishSettings(raw: string | null): StoredPolishSettings | null {
  if (raw === null) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { enabled, rulePresetId, dictionaryDefaultsSeeded } = value as Record<string, unknown>;
  if (
    typeof enabled !== 'boolean' ||
    (typeof rulePresetId !== 'string' && rulePresetId !== null) ||
    typeof dictionaryDefaultsSeeded !== 'boolean'
  ) {
    return null;
  }
  return { enabled, rulePresetId, dictionaryDefaultsSeeded };
}

/** What the store needs from storage. `state/polish.ts` passes the real ones; tests pass fakes. */
export interface PolishStoreDeps {
  /** The polish tables once the database is open and migrated. Rejects when the database is unusable. */
  openTables(): Promise<PolishTables>;
  /** Never rejects; null means "use the defaults". */
  readSettings(): Promise<StoredPolishSettings | null>;
  /**
   * Enqueues exactly one write on the shared SecureStore queue. `read` is called when that write
   * runs, not when it is enqueued, so the last edit wins. Never rejects; false means the write
   * failed (already logged).
   */
  saveSettings(read: () => StoredPolishSettings): Promise<boolean>;
}

export interface PolishState {
  /** The saved polish settings have been read, whether or not storage worked. */
  readonly loaded: boolean;
  /** Why polish storage is unusable, or null. Set only by loading. */
  readonly storageError: string | null;
  readonly enabled: boolean;
  /** Null until a writing style is chosen; onboarding asks for one before first use. */
  readonly activePresetId: string | null;
  readonly presets: readonly PolishRulePreset[];
  readonly dictionary: readonly DictionaryEntry[];
  setEnabled(enabled: boolean): void;
  setActivePreset(id: string): void;
  /** Rejects with a message the screen shows: a validation error, or a storage failure. */
  updatePreset(id: string, draft: PolishRulePresetDraft): Promise<void>;
  addEntry(term: string, hint: string): Promise<void>;
  setEntryEnabled(id: string, enabled: boolean): Promise<void>;
  removeEntry(id: string): Promise<void>;
}

/**
 * What the dictation engine reads. Not hooks, so it is safe to call from the keyboard's task.
 * Settings come from live store state; presets and dictionary come from the tables, so dictation
 * always uses what was committed, whatever the screens currently show.
 */
export interface PolishSources extends PolishSettingsReader, PolishRulesStore {
  /** Awaits loading; rejects with `storageError` when polish storage is unusable. */
  ready(): Promise<void>;
}

const LOG_TAG = '[toph:polish]';

/**
 * The polish settings: the on/off switch and active preset in SecureStore, presets and dictionary
 * in the database. The switches persist like the provider's model fields (set, then queue a write);
 * row edits validate against the tables, write, then re-read their list, one at a time.
 */
export function createPolishStore(deps: PolishStoreDeps): {
  usePolishStore: UseBoundStore<StoreApi<PolishState>>;
  /** Loads once per JS runtime. Never rejects and always ends with `loaded: true`. */
  loadPolish(): Promise<void>;
  polishSources: PolishSources;
} {
  /** Set by a successful load; actions and sources reach the database only through it. */
  let tables: PolishTables | null = null;
  /** True only once seeding has succeeded, so a settings save never claims seeding that did not happen. */
  let seeded = false;
  let loading: Promise<void> | undefined;
  let rowEdits: Promise<unknown> = Promise.resolve();

  /** Passed to `deps.saveSettings`; called by the queue when the write runs. */
  const currentSettings = (): StoredPolishSettings => {
    const { enabled, activePresetId } = usePolishStore.getState();
    return { enabled, rulePresetId: activePresetId, dictionaryDefaultsSeeded: seeded };
  };

  /** Runs `edit` after every earlier row edit has settled; rejects with `edit`'s error. */
  const queueRowEdit = (edit: (tables: PolishTables) => Promise<void>): Promise<void> => {
    const task = rowEdits.then(async () => edit(await usableTables()));
    rowEdits = task.catch(() => {});
    return task;
  };

  const usableTables = async (): Promise<PolishTables> => {
    await loadPolish();
    if (tables === null) {
      throw new Error(usePolishStore.getState().storageError ?? 'Polish storage is unavailable.');
    }
    return tables;
  };

  /** Re-reads one list after a committed write, keeping desktop's ordering. */
  const refresh = async (from: PolishTables, list: 'presets' | 'dictionary'): Promise<void> => {
    try {
      if (list === 'presets') {
        usePolishStore.setState({ presets: await from.listPolishRulePresets() });
      } else {
        usePolishStore.setState({ dictionary: await from.listDictionaryEntries() });
      }
    } catch (error) {
      throw new Error(`Saved, but the list could not be refreshed: ${describeError(error)}`, {
        cause: error,
      });
    }
  };

  const usePolishStore = create<PolishState>()((set) => ({
    loaded: false,
    storageError: null,
    enabled: defaultPolishSettings.enabled,
    activePresetId: defaultPolishSettings.rulePresetId,
    presets: [],
    dictionary: [],
    setEnabled: (enabled) => {
      set({ enabled });
      void deps.saveSettings(currentSettings);
    },
    setActivePreset: (activePresetId) => {
      set({ activePresetId });
      void deps.saveSettings(currentSettings);
    },
    updatePreset: (id, draft) =>
      queueRowEdit(async (from) => {
        await from.updatePolishRulePreset(id, normalizeRulePresetDraft(draft));
        await refresh(from, 'presets');
      }),
    addEntry: (term, hint) =>
      queueRowEdit(async (from) => {
        const draft = normalizeDictionaryEntryDraft({
          term,
          hint: hint === '' ? null : hint,
          enabled: true,
        });
        ensureDictionaryEnabledLimit({ entries: await from.listDictionaryEntries(), draft });
        await from.createDictionaryEntry(draft);
        await refresh(from, 'dictionary');
      }),
    setEntryEnabled: (id, enabled) =>
      queueRowEdit(async (from) => {
        const entries = await from.listDictionaryEntries();
        const entry = entries.find((candidate) => candidate.id === id);
        if (entry === undefined) {
          throw new Error(`Dictionary entry "${id}" is not available.`);
        }
        const draft = normalizeDictionaryEntryDraft({
          term: entry.term,
          hint: entry.hint,
          enabled,
        });
        ensureDictionaryEnabledLimit({ entries, draft, existingId: id });
        await from.updateDictionaryEntry(id, draft);
        await refresh(from, 'dictionary');
      }),
    removeEntry: (id) =>
      queueRowEdit(async (from) => {
        await from.deleteDictionaryEntry(id);
        await refresh(from, 'dictionary');
      }),
  }));

  // The order is a correctness rule: saved settings reach state before anything can queue a
  // settings write, so the seeding save below cannot overwrite them with the defaults.
  const load = async (): Promise<void> => {
    const settings = (await deps.readSettings()) ?? defaultPolishSettings;
    usePolishStore.setState({ enabled: settings.enabled, activePresetId: settings.rulePresetId });
    seeded = settings.dictionaryDefaultsSeeded;
    try {
      const opened = await deps.openTables();
      tables = opened;
      await opened.syncBuiltinPolishRulePresets();
      if (!seeded) {
        await seedDefaultDictionaryEntries(opened);
        seeded = true;
        void deps.saveSettings(currentSettings);
      }
      const presets = await opened.listPolishRulePresets();
      const dictionary = await opened.listDictionaryEntries();
      usePolishStore.setState({ loaded: true, storageError: null, presets, dictionary });
    } catch (error) {
      tables = null;
      console.warn(`${LOG_TAG} storage is unusable`, error);
      usePolishStore.setState({
        loaded: true,
        storageError: describeError(error),
        presets: [],
        dictionary: [],
      });
    }
  };

  function loadPolish(): Promise<void> {
    loading ??= load();
    return loading;
  }

  const polishSources: PolishSources = {
    getSettings: () => {
      const { enabled, activePresetId } = usePolishStore.getState();
      return { polish: { enabled, rulePresetId: activePresetId } };
    },
    getPolishRulePreset: async (id) => (await usableTables()).getPolishRulePreset(id),
    listDictionaryEntries: async () => (await usableTables()).listDictionaryEntries(),
    ready: async () => {
      await usableTables();
    },
  };

  return { usePolishStore, loadPolish, polishSources };
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error.';
}
