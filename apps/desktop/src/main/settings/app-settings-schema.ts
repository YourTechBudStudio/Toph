import { z } from 'zod';

import {
  DEFAULT_APP_SETTINGS,
  PROVIDER_IDS,
  resolveDefaultShortcutChord,
  resolveDefaultRuleSwitcherShortcutChord,
  SYSTEM_DEFAULT_AUDIO_DEVICE_ID,
  validateShortcutChord,
  type AppSettings,
  type ProviderId,
} from '@toph/desktop-contracts';

const shortcutModifierSchema = z.enum(['command', 'control', 'option', 'alt', 'shift']);
const shortcutChordSchema = z.object({
  modifiers: z.array(shortcutModifierSchema),
  key: z.string(),
});
const audioDevicePreferenceSchema = z.object({
  id: z.string(),
  label: z.string().nullable().optional(),
});

const appSettingsFileSchema = z.object({
  version: z.literal(1),
  shortcut: z
    .object({
      chord: shortcutChordSchema,
    })
    .optional(),
  ruleSwitcherShortcut: z
    .object({
      chord: shortcutChordSchema,
    })
    .optional(),
  auth: z.object({
    providerId: z.string(),
  }),
  transcription: z.object({
    providerId: z.string(),
    model: z.string(),
  }),
  inference: z.object({
    providerId: z.string(),
    model: z.string(),
  }),
  audio: z
    .object({
      inputDevice: audioDevicePreferenceSchema.optional(),
      outputDevice: audioDevicePreferenceSchema.optional(),
    })
    .optional(),
  polish: z.object({
    enabled: z.boolean(),
    rulePresetId: z.string().nullable().optional(),
    promptId: z.string().optional(),
    dictionaryDefaultsSeeded: z.boolean().optional(),
  }),
  dashboard: z
    .object({
      typingWpm: z.number(),
    })
    .optional(),
});

type AppSettingsFile = z.infer<typeof appSettingsFileSchema>;

export const defaultAppSettings: AppSettings = {
  ...DEFAULT_APP_SETTINGS,
  shortcut: {
    chord: resolveDefaultShortcutChord(process.platform),
  },
  ruleSwitcherShortcut: {
    chord: resolveDefaultRuleSwitcherShortcutChord(process.platform),
  },
};

function isKnownProviderId(providerId: string): providerId is ProviderId {
  return PROVIDER_IDS.includes(providerId as ProviderId);
}

function normalizeProviderId(providerId: string, fallback: ProviderId) {
  return isKnownProviderId(providerId) ? providerId : fallback;
}

function normalizeModel(model: string, fallback: string) {
  const trimmed = model.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeTypingWpm(typingWpm: number | undefined) {
  return typingWpm !== undefined &&
    Number.isFinite(typingWpm) &&
    typingWpm >= 20 &&
    typingWpm <= 200
    ? Math.round(typingWpm)
    : defaultAppSettings.dashboard.typingWpm;
}

function normalizeAudioDevicePreference(
  value: z.infer<typeof audioDevicePreferenceSchema> | undefined,
): AppSettings['audio']['inputDevice'] {
  if (!value || value.id.trim().length === 0) {
    return { id: SYSTEM_DEFAULT_AUDIO_DEVICE_ID, label: null };
  }

  const label = value.label?.trim() ?? '';
  return {
    id: value.id,
    label: label.length > 0 ? label : null,
  };
}

export function parseAppSettingsFile(value: unknown): AppSettingsFile {
  return appSettingsFileSchema.parse(value);
}

export function normalizeAppSettings(
  value: AppSettingsFile,
  options: { rulePresetIds: string[] },
): AppSettings {
  const selectedRulePresetId = value.polish.rulePresetId ?? value.polish.promptId ?? null;
  const rulePresetId =
    selectedRulePresetId && options.rulePresetIds.includes(selectedRulePresetId)
      ? selectedRulePresetId
      : null;
  const shortcutValidation = value.shortcut ? validateShortcutChord(value.shortcut.chord) : null;
  const ruleSwitcherShortcutValidation = value.ruleSwitcherShortcut
    ? validateShortcutChord(value.ruleSwitcherShortcut.chord)
    : null;

  return {
    version: 1,
    shortcut: {
      chord: shortcutValidation?.valid
        ? shortcutValidation.chord
        : defaultAppSettings.shortcut.chord,
    },
    ruleSwitcherShortcut: {
      chord: ruleSwitcherShortcutValidation?.valid
        ? ruleSwitcherShortcutValidation.chord
        : defaultAppSettings.ruleSwitcherShortcut.chord,
    },
    auth: {
      providerId: normalizeProviderId(value.auth.providerId, defaultAppSettings.auth.providerId),
    },
    transcription: {
      providerId: normalizeProviderId(
        value.transcription.providerId,
        defaultAppSettings.transcription.providerId,
      ),
      model: normalizeModel(value.transcription.model, defaultAppSettings.transcription.model),
    },
    inference: {
      providerId: normalizeProviderId(
        value.inference.providerId,
        defaultAppSettings.inference.providerId,
      ),
      model: normalizeModel(value.inference.model, defaultAppSettings.inference.model),
    },
    audio: {
      inputDevice: normalizeAudioDevicePreference(value.audio?.inputDevice),
      outputDevice: normalizeAudioDevicePreference(value.audio?.outputDevice),
    },
    polish: {
      enabled: value.polish.enabled,
      rulePresetId,
      dictionaryDefaultsSeeded: value.polish.dictionaryDefaultsSeeded ?? false,
    },
    dashboard: {
      typingWpm: normalizeTypingWpm(value.dashboard?.typingWpm),
    },
  };
}
