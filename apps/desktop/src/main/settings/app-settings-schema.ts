import { z } from 'zod';

import {
  DEFAULT_ANTIGRAVITY_TRANSCRIPTION_MODEL,
  DEFAULT_ANTIGRAVITY_INFERENCE_MODEL,
  DEFAULT_APP_SETTINGS,
  DEFAULT_INFERENCE_MODEL,
  DEFAULT_TRANSCRIPTION_MODEL,
  INFERENCE_PROVIDER_IDS,
  PROVIDER_IDS,
  TRANSCRIPTION_PROVIDER_IDS,
  resolveDefaultShortcutChord,
  resolveDefaultRuleSwitcherShortcutChord,
  validateShortcutChord,
  type AppSettings,
  type ProviderId,
} from '@toph/desktop-contracts';

const shortcutModifierSchema = z.enum(['command', 'control', 'option', 'alt', 'shift']);
const shortcutChordSchema = z.object({
  modifiers: z.array(shortcutModifierSchema),
  key: z.string(),
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
  polish: z.object({
    enabled: z.boolean(),
    rulePresetId: z.string().nullable().optional(),
    promptId: z.string().optional(),
  }),
  context: z
    .object({
      screenshots: z
        .object({
          enabled: z.boolean(),
        })
        .optional(),
      dictationPrompt: z
        .object({
          enabled: z.boolean(),
        })
        .optional(),
    })
    .optional(),
  dashboard: z
    .object({
      typingWpm: z.number(),
    })
    .optional(),
  diagnostics: z
    .object({
      enabled: z.boolean(),
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

function normalizeProviderIdFromList(
  providerId: string,
  allowedProviderIds: readonly ProviderId[],
  fallback: ProviderId,
) {
  return allowedProviderIds.includes(providerId as ProviderId)
    ? (providerId as ProviderId)
    : fallback;
}

function normalizeModel(model: string, fallback: string) {
  const trimmed = model.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export function getDefaultInferenceModel(providerId: ProviderId) {
  return providerId === 'antigravity'
    ? DEFAULT_ANTIGRAVITY_INFERENCE_MODEL
    : DEFAULT_INFERENCE_MODEL;
}

export function getDefaultTranscriptionModel(providerId: ProviderId) {
  return providerId === 'antigravity'
    ? DEFAULT_ANTIGRAVITY_TRANSCRIPTION_MODEL
    : DEFAULT_TRANSCRIPTION_MODEL;
}

function normalizeTypingWpm(typingWpm: number | undefined) {
  return typingWpm !== undefined &&
    Number.isFinite(typingWpm) &&
    typingWpm >= 20 &&
    typingWpm <= 200
    ? Math.round(typingWpm)
    : defaultAppSettings.dashboard.typingWpm;
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

  const transcriptionProviderId = normalizeProviderIdFromList(
    value.transcription.providerId,
    TRANSCRIPTION_PROVIDER_IDS,
    defaultAppSettings.transcription.providerId,
  );
  const inferenceProviderId = normalizeProviderIdFromList(
    value.inference.providerId,
    INFERENCE_PROVIDER_IDS,
    defaultAppSettings.inference.providerId,
  );

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
      providerId: transcriptionProviderId,
      model: normalizeModel(
        value.transcription.model,
        getDefaultTranscriptionModel(transcriptionProviderId),
      ),
    },
    inference: {
      providerId: inferenceProviderId,
      model: normalizeModel(value.inference.model, getDefaultInferenceModel(inferenceProviderId)),
    },
    polish: {
      enabled: value.polish.enabled,
      rulePresetId,
    },
    context: {
      screenshots: {
        enabled:
          value.context?.screenshots?.enabled ?? defaultAppSettings.context.screenshots.enabled,
      },
      dictationPrompt: {
        enabled:
          value.context?.dictationPrompt?.enabled ??
          defaultAppSettings.context.dictationPrompt.enabled,
      },
    },
    dashboard: {
      typingWpm: normalizeTypingWpm(value.dashboard?.typingWpm),
    },
    diagnostics: {
      enabled: value.diagnostics?.enabled ?? defaultAppSettings.diagnostics.enabled,
    },
  };
}
