import { rename, readFile, writeFile } from 'node:fs/promises';

import type {
  AppSettings,
  AudioDevicePreference,
  ProviderId,
  ShortcutChord,
} from '@toph/desktop-contracts';

import {
  defaultAppSettings,
  normalizeAppSettings,
  parseAppSettingsFile,
} from './app-settings-schema';

export interface AppSettingsStore {
  getSettings: () => AppSettings;
  subscribe: (listener: (settings: AppSettings) => void) => () => void;
  reloadFromDisk: () => Promise<AppSettings>;
  setShortcut: (chord: ShortcutChord) => Promise<AppSettings>;
  setRuleSwitcherShortcut: (chord: ShortcutChord) => Promise<AppSettings>;
  setAuthProvider: (providerId: ProviderId) => Promise<AppSettings>;
  setTranscriptionProvider: (providerId: ProviderId) => Promise<AppSettings>;
  setTranscriptionModel: (model: string) => Promise<AppSettings>;
  setInferenceProvider: (providerId: ProviderId) => Promise<AppSettings>;
  setInferenceModel: (model: string) => Promise<AppSettings>;
  setAudioInputDevice: (device: AudioDevicePreference) => Promise<AppSettings>;
  setAudioOutputDevice: (device: AudioDevicePreference) => Promise<AppSettings>;
  setPolishEnabled: (enabled: boolean) => Promise<AppSettings>;
  setTypingWpm: (typingWpm: number) => Promise<AppSettings>;
  setPolishRulePreset: (rulePresetId: string) => Promise<AppSettings>;
  markDictionaryDefaultsSeeded: () => Promise<AppSettings>;
}

function cloneSettings(settings: AppSettings): AppSettings {
  return JSON.parse(JSON.stringify(settings)) as AppSettings;
}

function settingsEqual(left: AppSettings, right: AppSettings) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function invalidSettingsPath(settingsPath: string) {
  return settingsPath.replace(/\.json$/i, `.invalid.${Date.now()}.json`);
}

export async function createAppSettingsStore(options: {
  settingsPath: string;
  listRulePresetIds: () => Promise<string[]>;
  defaultSettings?: AppSettings;
}): Promise<AppSettingsStore> {
  const listeners = new Set<(settings: AppSettings) => void>();
  const fallbackSettings = options.defaultSettings ?? defaultAppSettings;
  let settings = cloneSettings(fallbackSettings);
  let writeQueue: Promise<unknown> = Promise.resolve();

  const writeSettings = async (next: AppSettings) => {
    await writeFile(options.settingsPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  };

  const publish = () => {
    for (const listener of listeners) {
      listener(settings);
    }
  };

  const normalizeWithCurrentRules = async (value: unknown) =>
    normalizeAppSettings(parseAppSettingsFile(value), {
      rulePresetIds: await options.listRulePresetIds(),
    });

  const loadFromDisk = async () => {
    let raw: string;
    try {
      raw = await readFile(options.settingsPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }

      const defaults = normalizeAppSettings(fallbackSettings, {
        rulePresetIds: await options.listRulePresetIds(),
      });
      await writeSettings(defaults);
      return defaults;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      const normalized = await normalizeWithCurrentRules(parsed);
      if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
        await writeSettings(normalized);
      }
      return normalized;
    } catch {
      await rename(options.settingsPath, invalidSettingsPath(options.settingsPath));
      const defaults = normalizeAppSettings(fallbackSettings, {
        rulePresetIds: await options.listRulePresetIds(),
      });
      await writeSettings(defaults);
      return defaults;
    }
  };

  const commit = async (update: (draft: AppSettings) => void) => {
    const task = writeQueue.then(async () => {
      const draft = cloneSettings(settings);
      update(draft);
      const normalized = normalizeAppSettings(draft, {
        rulePresetIds: await options.listRulePresetIds(),
      });
      if (!settingsEqual(settings, normalized)) {
        await writeSettings(normalized);
        settings = normalized;
        publish();
      }
      return settings;
    });
    writeQueue = task.catch(() => {});
    return task;
  };

  settings = await loadFromDisk();

  return {
    getSettings() {
      return settings;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async reloadFromDisk() {
      const next = await loadFromDisk();
      if (!settingsEqual(settings, next)) {
        settings = next;
        publish();
      }
      return settings;
    },

    setShortcut(chord) {
      return commit((draft) => {
        draft.shortcut.chord = chord;
      });
    },

    setRuleSwitcherShortcut(chord) {
      return commit((draft) => {
        draft.ruleSwitcherShortcut.chord = chord;
      });
    },

    setAuthProvider(providerId) {
      return commit((draft) => {
        draft.auth.providerId = providerId;
      });
    },

    setTranscriptionProvider(providerId) {
      return commit((draft) => {
        draft.transcription.providerId = providerId;
      });
    },

    setTranscriptionModel(model) {
      return commit((draft) => {
        draft.transcription.model = model;
      });
    },

    setInferenceProvider(providerId) {
      return commit((draft) => {
        draft.inference.providerId = providerId;
      });
    },

    setInferenceModel(model) {
      return commit((draft) => {
        draft.inference.model = model;
      });
    },

    setAudioInputDevice(device) {
      return commit((draft) => {
        draft.audio.inputDevice = device;
      });
    },

    setAudioOutputDevice(device) {
      return commit((draft) => {
        draft.audio.outputDevice = device;
      });
    },

    setPolishEnabled(enabled) {
      return commit((draft) => {
        draft.polish.enabled = enabled;
      });
    },

    setTypingWpm(typingWpm) {
      return commit((draft) => {
        draft.dashboard.typingWpm = typingWpm;
      });
    },

    setPolishRulePreset(rulePresetId) {
      return commit((draft) => {
        draft.polish.rulePresetId = rulePresetId;
      });
    },

    markDictionaryDefaultsSeeded() {
      return commit((draft) => {
        draft.polish.dictionaryDefaultsSeeded = true;
      });
    },
  };
}
