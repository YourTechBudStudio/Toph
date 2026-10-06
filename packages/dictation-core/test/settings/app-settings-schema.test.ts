import assert from 'node:assert/strict';
import test from 'node:test';

import type { HostPlatform, ProviderFieldSpec } from '@toph/desktop-contracts';

import {
  normalizeAppSettings,
  parseAppSettingsFile,
} from '../../src/settings/app-settings-schema.ts';

/**
 * Mirrors what `providers/openai-sub/definition.ts` declares. Declared here rather than imported
 * because that module reaches the OAuth page, which imports a bundler-only asset URL that plain
 * Node cannot resolve. Only `openai-sub` is registered in this phase, so `openai` is absent.
 */
const declarations = {
  providerDeclarations: {
    'openai-sub': {
      roles: ['transcription', 'inference'] as const,
      settingsFields: {
        provider: [] as ProviderFieldSpec[],
        transcription: [
          {
            kind: 'text',
            key: 'model',
            label: 'Transcription model',
            default: 'chatgpt-backend-transcribe',
            required: true,
          },
        ] as ProviderFieldSpec[],
        inference: [
          {
            kind: 'text',
            key: 'model',
            label: 'Polishing model',
            default: 'gpt-5.6-luna',
            required: true,
          },
          {
            kind: 'text',
            key: 'reasoningEffort',
            label: 'Reasoning effort',
            default: 'medium',
          },
        ] as ProviderFieldSpec[],
      },
    },
  },
};

const openAiSubDefaults = {
  provider: {},
  transcription: { model: 'chatgpt-backend-transcribe' },
  inference: { model: 'gpt-5.6-luna', reasoningEffort: 'medium' },
};

const emptyGroups = { provider: {}, transcription: {}, inference: {} };

// Every test normalises as a macOS host, so the expected shortcut defaults are fixed literals.
const darwinOptions = { platform: 'darwin' as HostPlatform, ...declarations };

function normalize(value: unknown, rulePresetIds: string[] = ['general']) {
  return normalizeAppSettings(parseAppSettingsFile(value), { rulePresetIds, ...darwinOptions });
}

test('normalizes unknown providers and unknown rule presets to unresolved setup', () => {
  const settings = normalize({
    version: 1,
    shortcut: { chord: { modifiers: ['control', 'alt'], key: 'Space' } },
    auth: { providerId: 'unknown-auth' },
    transcription: { providerId: 'unknown-transcription', model: '   ' },
    inference: { providerId: 'unknown-inference', model: '' },
    polish: { enabled: true, rulePresetId: 'missing-rule' },
  });

  assert.deepEqual(settings, {
    version: 1,
    shortcut: { chord: { modifiers: ['control', 'alt'], key: 'Space' } },
    ruleSwitcherShortcut: { chord: { modifiers: ['option'], key: 'Space' } },
    transcription: { providerId: null },
    inference: { providerId: null },
    providers: { 'openai-sub': openAiSubDefaults, openai: emptyGroups },
    audio: {
      inputDevice: { id: 'default', label: null },
      outputDevice: { id: 'default', label: null },
    },
    polish: { enabled: true, rulePresetId: null, dictionaryDefaultsSeeded: false },
    dashboard: { typingWpm: 50 },
  });
});

test('drops the removed auth block and the old routing model values', () => {
  const settings = normalize({
    version: 1,
    auth: { providerId: 'openai-sub' },
    transcription: { providerId: 'openai-sub', model: 'a-model-someone-picked' },
    inference: { providerId: 'openai-sub', model: 'another-model' },
    polish: { enabled: true, rulePresetId: 'general' },
  });

  assert.deepEqual(settings.transcription, { providerId: 'openai-sub' });
  assert.deepEqual(settings.inference, { providerId: 'openai-sub' });
  assert.equal('auth' in settings, false);
  assert.deepEqual(settings.providers['openai-sub'], openAiSubDefaults);
});

test('unroutes a role when the chosen provider is not registered', () => {
  const settings = normalize({
    version: 1,
    transcription: { providerId: 'openai' },
    inference: { providerId: 'openai' },
    polish: { enabled: true, rulePresetId: 'general' },
  });

  // Never a fallback provider: picking one for the user would be the preference Toph does not have.
  assert.equal(settings.transcription.providerId, null);
  assert.equal(settings.inference.providerId, null);
});

test('accepts a settings file that has no provider chosen yet', () => {
  const settings = normalize({
    version: 1,
    transcription: { providerId: null },
    inference: { providerId: null },
    polish: { enabled: true, rulePresetId: 'general' },
  });

  assert.equal(settings.transcription.providerId, null);
  assert.equal(settings.inference.providerId, null);
});

test('keeps declared provider values and drops undeclared ones', () => {
  const settings = normalize({
    version: 1,
    transcription: { providerId: 'openai-sub' },
    inference: { providerId: 'openai-sub' },
    providers: {
      'openai-sub': {
        transcription: { model: '  whisper-1  ', nonsense: 'ignored' },
        inference: { model: '', reasoningEffort: '' },
      },
      'not-a-provider': { inference: { model: 'nope' } },
    },
    polish: { enabled: true, rulePresetId: 'general' },
  });

  assert.deepEqual(settings.providers['openai-sub'], {
    provider: {},
    // A required model can never be empty, so it falls back; reasoning effort may be, and stays.
    transcription: { model: 'whisper-1' },
    inference: { model: 'gpt-5.6-luna', reasoningEffort: '' },
  });
  assert.deepEqual(Object.keys(settings.providers).sort(), ['openai', 'openai-sub']);
});

test('normalizes existing v1 settings without a shortcut to the platform default', () => {
  const settings = normalize({
    version: 1,
    auth: { providerId: 'openai-sub' },
    transcription: { providerId: 'openai-sub', model: 'chatgpt-backend-transcribe' },
    inference: { providerId: 'openai-sub', model: 'gpt-5.4-mini' },
    polish: { enabled: false, rulePresetId: 'general' },
  });

  assert.deepEqual(settings.shortcut.chord, { modifiers: ['control', 'option'], key: 'Space' });
  assert.equal(settings.polish.enabled, false);
  assert.equal(settings.polish.dictionaryDefaultsSeeded, false);
  assert.deepEqual(settings.audio, {
    inputDevice: { id: 'default', label: null },
    outputDevice: { id: 'default', label: null },
  });
});

test('normalizes persisted audio device labels', () => {
  const settings = normalize({
    version: 1,
    transcription: { providerId: 'openai-sub' },
    inference: { providerId: 'openai-sub' },
    audio: {
      inputDevice: { id: 'mic-1', label: '  Blue Yeti  ' },
      outputDevice: { id: 'speaker-1', label: '   ' },
    },
    polish: { enabled: false, rulePresetId: 'general' },
  });

  assert.deepEqual(settings.audio, {
    inputDevice: { id: 'mic-1', label: 'Blue Yeti' },
    outputDevice: { id: 'speaker-1', label: null },
  });
});

test('preserves legacy active prompt IDs as rule preset IDs when available', () => {
  const settings = normalize(
    {
      version: 1,
      transcription: { providerId: 'openai-sub' },
      inference: { providerId: 'openai-sub' },
      polish: { enabled: true, promptId: 'default' },
    },
    ['default', 'general'],
  );

  assert.equal(settings.polish.rulePresetId, 'default');
});

test('preserves the dictionary default seed marker', () => {
  const settings = normalize({
    version: 1,
    transcription: { providerId: 'openai-sub' },
    inference: { providerId: 'openai-sub' },
    polish: { enabled: true, rulePresetId: 'general', dictionaryDefaultsSeeded: true },
  });

  assert.equal(settings.polish.dictionaryDefaultsSeeded, true);
});

test('rejects invalid settings structure', () => {
  assert.throws(() =>
    parseAppSettingsFile({
      version: 1,
      shortcut: { chord: { modifiers: ['control', 'alt'], key: 'Space' } },
      transcription: { providerId: 'openai-sub' },
      inference: { providerId: 'openai-sub' },
      polish: { enabled: 'yes', rulePresetId: 'general' },
    }),
  );
});

test('falls back to the shortcut defaults of the platform it is given', () => {
  const settings = normalizeAppSettings(
    parseAppSettingsFile({
      version: 1,
      transcription: { providerId: 'openai-sub' },
      inference: { providerId: 'openai-sub' },
      polish: { enabled: false, rulePresetId: 'general' },
    }),
    { rulePresetIds: ['general'], ...darwinOptions, platform: 'linux' },
  );

  assert.deepEqual(settings.shortcut.chord, { modifiers: ['control', 'alt'], key: 'Space' });
  assert.deepEqual(settings.ruleSwitcherShortcut.chord, { modifiers: ['control'], key: 'Space' });
});
