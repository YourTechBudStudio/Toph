import assert from 'node:assert/strict';
import test from 'node:test';

import type { AppSettings } from '@toph/desktop-contracts';

import type { DictionaryEntry } from '../../src/main/db/schema.ts';
import { seedDefaultDictionaryEntriesIfNeeded } from '../../src/main/settings/default-dictionary-entries.ts';
import { maxEnabledDictionaryEntries } from '../../src/main/settings/writing-settings-validation.ts';

const baseSettings: AppSettings = {
  version: 1,
  shortcut: { chord: { modifiers: ['control', 'alt'], key: 'Space' } },
  ruleSwitcherShortcut: { chord: { modifiers: ['control'], key: 'Space' } },
  auth: { providerId: 'openai-sub' },
  transcription: { providerId: 'openai-sub', model: 'chatgpt-backend-transcribe' },
  inference: { providerId: 'openai-sub', model: 'gpt-5.4-mini' },
  audio: {
    inputDevice: { id: 'default', label: null },
    outputDevice: { id: 'default', label: null },
  },
  polish: { enabled: true, rulePresetId: 'general', dictionaryDefaultsSeeded: false },
  dashboard: { typingWpm: 50 },
};

function createDictionaryEntry(entry: Partial<DictionaryEntry>): DictionaryEntry {
  return {
    id: entry.id ?? 'dictionary_entry_1',
    term: entry.term ?? 'Toph',
    hint: entry.hint ?? null,
    enabled: entry.enabled ?? true,
    createdAt: entry.createdAt ?? 1,
    updatedAt: entry.updatedAt ?? 1,
  };
}

function createSettingsWithDictionarySeedMarker(
  settings: AppSettings,
  dictionaryDefaultsSeeded: boolean,
): AppSettings {
  return {
    ...settings,
    polish: {
      ...settings.polish,
      dictionaryDefaultsSeeded,
    },
  };
}

test('does not seed default dictionary entries after the marker is set', async () => {
  let listed = false;
  let marked = false;

  await seedDefaultDictionaryEntriesIfNeeded({
    settingsStore: {
      getSettings: () => createSettingsWithDictionarySeedMarker(baseSettings, true),
      markDictionaryDefaultsSeeded: async () => {
        marked = true;
        return baseSettings;
      },
    },
    sessionStore: {
      listDictionaryEntries: async () => {
        listed = true;
        return [];
      },
      createDictionaryEntry: async () => createDictionaryEntry({}),
      updateDictionaryEntry: async () => createDictionaryEntry({}),
    },
  });

  assert.equal(listed, false);
  assert.equal(marked, false);
});

test('seeds missing defaults and then marks the settings file', async () => {
  const created: Array<{ term: string; hint: string | null; enabled: boolean }> = [];
  let marked = false;

  await seedDefaultDictionaryEntriesIfNeeded({
    settingsStore: {
      getSettings: () => baseSettings,
      markDictionaryDefaultsSeeded: async () => {
        marked = true;
        return createSettingsWithDictionarySeedMarker(baseSettings, true);
      },
    },
    sessionStore: {
      listDictionaryEntries: async () => [],
      createDictionaryEntry: async (draft) => {
        created.push(draft);
        return createDictionaryEntry({ id: `dictionary_entry_${created.length}`, ...draft });
      },
      updateDictionaryEntry: async () => createDictionaryEntry({}),
    },
  });

  assert.deepEqual(created, [
    {
      term: 'Toph',
      hint: 'Proper noun: Sounds like "toff" and "tof"',
      enabled: true,
    },
    {
      term: 'Isagi',
      hint: 'Proper noun: Sounds like "e-sagi" and "EZG"',
      enabled: true,
    },
  ]);
  assert.equal(marked, true);
});

test('updates existing default hints without changing term casing or enabled state', async () => {
  const updated: Array<{
    id: string;
    draft: { term: string; hint: string | null; enabled: boolean };
  }> = [];
  const created: Array<{ term: string; hint: string | null; enabled: boolean }> = [];

  await seedDefaultDictionaryEntriesIfNeeded({
    settingsStore: {
      getSettings: () => baseSettings,
      markDictionaryDefaultsSeeded: async () =>
        createSettingsWithDictionarySeedMarker(baseSettings, true),
    },
    sessionStore: {
      listDictionaryEntries: async () => [
        createDictionaryEntry({
          id: 'dictionary_entry_toph',
          term: 'toph',
          hint: 'old hint',
          enabled: false,
        }),
        createDictionaryEntry({
          id: 'dictionary_entry_isagi',
          term: 'ISAGI',
          hint: 'Proper noun: Sounds like "e-sagi" and "EZG"',
          enabled: false,
        }),
      ],
      createDictionaryEntry: async (draft) => {
        created.push(draft);
        return createDictionaryEntry({ ...draft });
      },
      updateDictionaryEntry: async (id, draft) => {
        updated.push({ id, draft });
        return createDictionaryEntry({ id, ...draft });
      },
    },
  });

  assert.deepEqual(updated, [
    {
      id: 'dictionary_entry_toph',
      draft: {
        term: 'toph',
        hint: 'Proper noun: Sounds like "toff" and "tof"',
        enabled: false,
      },
    },
  ]);
  assert.deepEqual(created, []);
});

test('seeds missing defaults disabled when the enabled dictionary limit is full', async () => {
  const created: Array<{ term: string; hint: string | null; enabled: boolean }> = [];
  const existingEntries = Array.from({ length: maxEnabledDictionaryEntries }, (_, index) =>
    createDictionaryEntry({ id: `dictionary_entry_${index}`, term: `Term ${index}` }),
  );

  await seedDefaultDictionaryEntriesIfNeeded({
    settingsStore: {
      getSettings: () => baseSettings,
      markDictionaryDefaultsSeeded: async () =>
        createSettingsWithDictionarySeedMarker(baseSettings, true),
    },
    sessionStore: {
      listDictionaryEntries: async () => existingEntries,
      createDictionaryEntry: async (draft) => {
        const createdEntry = createDictionaryEntry({
          id: `dictionary_entry_created_${created.length}`,
          ...draft,
        });
        created.push(draft);
        return createdEntry;
      },
      updateDictionaryEntry: async () => createDictionaryEntry({}),
    },
  });

  assert.deepEqual(
    created.map((entry) => ({ term: entry.term, enabled: entry.enabled })),
    [
      { term: 'Toph', enabled: false },
      { term: 'Isagi', enabled: false },
    ],
  );
});
