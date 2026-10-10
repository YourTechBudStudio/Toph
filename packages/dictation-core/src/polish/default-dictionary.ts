import { MAX_ENABLED_DICTIONARY_ENTRIES } from '@toph/desktop-contracts';

import type { DictionaryEntry } from '../db/schema';

/** The dictionary operations seeding needs. Desktop's `RecordingSessionStore` satisfies it. */
export interface DictionarySeedStore {
  listDictionaryEntries: () => Promise<DictionaryEntry[]>;
  createDictionaryEntry: (draft: {
    term: string;
    hint: string | null;
    enabled: boolean;
  }) => Promise<DictionaryEntry>;
  updateDictionaryEntry: (
    id: string,
    draft: { term: string; hint: string | null; enabled: boolean },
  ) => Promise<DictionaryEntry>;
}

export const defaultDictionaryEntries = [
  {
    term: 'Toph',
    hint: 'Proper noun: Sounds like "toff" and "tof"',
  },
  {
    term: 'Isagi',
    hint: 'Proper noun: Sounds like "e-sagi" and "EZG"',
  },
];

export async function seedDefaultDictionaryEntries(sessionStore: DictionarySeedStore) {
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
