import { MAX_ENABLED_DICTIONARY_ENTRIES } from '@toph/desktop-contracts';

import type { DictionaryEntry } from '../db/schema';
import type { RecordingSessionStore } from '../stores/session-store';
import type { AppSettingsStore } from './app-settings-store';

const defaultDictionaryEntries = [
  {
    term: 'Toph',
    hint: 'Proper noun: Sounds like "toff" and "tof"',
  },
  {
    term: 'Isagi',
    hint: 'Proper noun: Sounds like "e-sagi" and "EZG"',
  },
];

export async function seedDefaultDictionaryEntriesIfNeeded(options: {
  settingsStore: Pick<AppSettingsStore, 'getSettings' | 'markDictionaryDefaultsSeeded'>;
  sessionStore: Pick<
    RecordingSessionStore,
    'createDictionaryEntry' | 'listDictionaryEntries' | 'updateDictionaryEntry'
  >;
}) {
  if (options.settingsStore.getSettings().polish.dictionaryDefaultsSeeded) {
    return;
  }

  await seedDefaultDictionaryEntries(options.sessionStore);
  await options.settingsStore.markDictionaryDefaultsSeeded();
}

async function seedDefaultDictionaryEntries(
  sessionStore: Pick<
    RecordingSessionStore,
    'createDictionaryEntry' | 'listDictionaryEntries' | 'updateDictionaryEntry'
  >,
) {
  const entries = await sessionStore.listDictionaryEntries();

  for (const defaultEntry of defaultDictionaryEntries) {
    const existing = findDictionaryEntryByTerm(entries, defaultEntry.term);

    if (existing) {
      if (existing.hint !== defaultEntry.hint) {
        await sessionStore.updateDictionaryEntry(existing.id, {
          term: existing.term,
          hint: defaultEntry.hint,
          enabled: existing.enabled,
        });
      }
      continue;
    }

    const created = await sessionStore.createDictionaryEntry({
      ...defaultEntry,
      enabled: hasEnabledDictionaryCapacity(entries),
    });
    entries.push(created);
  }
}

function findDictionaryEntryByTerm(entries: DictionaryEntry[], term: string) {
  const normalizedTerm = normalizeDictionaryTerm(term);
  return entries.find((entry) => normalizeDictionaryTerm(entry.term) === normalizedTerm) ?? null;
}

function normalizeDictionaryTerm(term: string) {
  return term.trim().toLowerCase();
}

function hasEnabledDictionaryCapacity(entries: DictionaryEntry[]) {
  return entries.filter((entry) => entry.enabled).length < MAX_ENABLED_DICTIONARY_ENTRIES;
}
