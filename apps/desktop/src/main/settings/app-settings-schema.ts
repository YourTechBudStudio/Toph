import { z } from 'zod';

import {
  applyProviderFieldDefaults,
  DEFAULT_APP_SETTINGS,
  PROVIDER_IDS,
  PROVIDER_SETTINGS_GROUPS,
  resolveDefaultShortcutChord,
  resolveDefaultRuleSwitcherShortcutChord,
  SYSTEM_DEFAULT_AUDIO_DEVICE_ID,
  validateShortcutChord,
  type AppSettings,
  type ProviderFieldSpec,
  type ProviderId,
  type ProviderRole,
  type ProviderSettings,
  type ProviderSettingsGroup,
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
  // Accepted and ignored: `auth` and the two `model` keys belonged to the single-provider world,
  // and models are now declared per provider. Tolerated here so an existing file still parses.
  auth: z
    .object({
      providerId: z.string(),
    })
    .optional(),
  transcription: z.object({
    providerId: z.string(),
    model: z.string().optional(),
  }),
  inference: z.object({
    providerId: z.string(),
    model: z.string().optional(),
  }),
  providers: z
    .record(z.string(), z.record(z.string(), z.record(z.string(), z.unknown())))
    .optional(),
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

/** What normalisation needs to know about one provider, as its definition declares it. */
export interface ProviderDeclaration {
  roles: readonly ProviderRole[];
  settingsFields: Record<ProviderSettingsGroup, ProviderFieldSpec[]>;
}

export interface ProviderSettingsDeclarations {
  /** One entry per registered provider; a provider with no definition in this build is absent. */
  providerDeclarations: Partial<Record<ProviderId, ProviderDeclaration>>;
}

function isKnownProviderId(providerId: string): providerId is ProviderId {
  return PROVIDER_IDS.includes(providerId as ProviderId);
}

/**
 * A routing choice is only kept when the provider exists and actually serves that role, so a
 * settings file naming a provider that this build does not register falls back to the default.
 */
function normalizeRoutedProviderId(
  providerId: string,
  role: ProviderRole,
  fallback: ProviderId,
  declarations: ProviderSettingsDeclarations['providerDeclarations'],
) {
  return isKnownProviderId(providerId) && declarations[providerId]?.roles.includes(role)
    ? providerId
    : fallback;
}

function normalizeProviderSettings(
  value: Record<string, Record<string, Record<string, unknown>>> | undefined,
  declarations: ProviderSettingsDeclarations,
): Record<ProviderId, ProviderSettings> {
  const providers = {} as Record<ProviderId, ProviderSettings>;
  for (const providerId of PROVIDER_IDS) {
    const fields = declarations.providerDeclarations[providerId]?.settingsFields;
    const stored = value?.[providerId];
    const groups = {} as ProviderSettings;
    for (const group of PROVIDER_SETTINGS_GROUPS) {
      groups[group] = applyProviderFieldDefaults(fields?.[group] ?? [], stored?.[group]);
    }
    providers[providerId] = groups;
  }
  return providers;
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
  options: { rulePresetIds: string[] } & ProviderSettingsDeclarations,
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
    transcription: {
      providerId: normalizeRoutedProviderId(
        value.transcription.providerId,
        'transcription',
        defaultAppSettings.transcription.providerId,
        options.providerDeclarations,
      ),
    },
    inference: {
      providerId: normalizeRoutedProviderId(
        value.inference.providerId,
        'inference',
        defaultAppSettings.inference.providerId,
        options.providerDeclarations,
      ),
    },
    providers: normalizeProviderSettings(value.providers, options),
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
