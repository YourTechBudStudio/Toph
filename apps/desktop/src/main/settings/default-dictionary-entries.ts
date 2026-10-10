import { seedDefaultDictionaryEntries } from '@toph/dictation-core';

import type { RecordingSessionStore } from '../stores/session-store';
import type { AppSettingsStore } from './app-settings-store';

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
