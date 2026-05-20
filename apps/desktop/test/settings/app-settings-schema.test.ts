import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveDefaultRuleSwitcherShortcutChord,
  resolveDefaultShortcutChord,
} from '@toph/desktop-contracts';

import {
  normalizeAppSettings,
  parseAppSettingsFile,
} from '../../src/main/settings/app-settings-schema.ts';

test('normalizes unknown providers, empty models, and unknown rule presets to unresolved setup', () => {
  const settings = normalizeAppSettings(
    parseAppSettingsFile({
      version: 1,
      shortcut: { chord: { modifiers: ['control', 'alt'], key: 'Space' } },
      auth: { providerId: 'unknown-auth' },
      transcription: { providerId: 'unknown-transcription', model: '   ' },
      inference: { providerId: 'unknown-inference', model: '' },
      polish: { enabled: true, rulePresetId: 'missing-rule' },
    }),
    { rulePresetIds: ['general'] },
  );

  assert.deepEqual(settings, {
    version: 1,
    shortcut: { chord: { modifiers: ['control', 'alt'], key: 'Space' } },
    ruleSwitcherShortcut: { chord: resolveDefaultRuleSwitcherShortcutChord(process.platform) },
    auth: { providerId: 'openai-sub' },
    transcription: { providerId: 'openai-sub', model: 'chatgpt-backend-transcribe' },
    inference: { providerId: 'openai-sub', model: 'gpt-5.4-mini' },
    audio: {
      inputDevice: { id: 'default', label: null },
      outputDevice: { id: 'default', label: null },
    },
    polish: { enabled: true, rulePresetId: null },
    dashboard: { typingWpm: 50 },
  });
});

test('normalizes existing v1 settings without a shortcut to the platform default', () => {
  const settings = normalizeAppSettings(
    parseAppSettingsFile({
      version: 1,
      auth: { providerId: 'openai-sub' },
      transcription: { providerId: 'openai-sub', model: 'chatgpt-backend-transcribe' },
      inference: { providerId: 'openai-sub', model: 'gpt-5.4-mini' },
      polish: { enabled: false, rulePresetId: 'general' },
    }),
    { rulePresetIds: ['general'] },
  );

  assert.deepEqual(settings.shortcut.chord, resolveDefaultShortcutChord(process.platform));
  assert.equal(settings.polish.enabled, false);
  assert.deepEqual(settings.audio, {
    inputDevice: { id: 'default', label: null },
    outputDevice: { id: 'default', label: null },
  });
});

test('normalizes persisted audio device labels', () => {
  const settings = normalizeAppSettings(
    parseAppSettingsFile({
      version: 1,
      auth: { providerId: 'openai-sub' },
      transcription: { providerId: 'openai-sub', model: 'chatgpt-backend-transcribe' },
      inference: { providerId: 'openai-sub', model: 'gpt-5.4-mini' },
      audio: {
        inputDevice: { id: 'mic-1', label: '  Blue Yeti  ' },
        outputDevice: { id: 'speaker-1', label: '   ' },
      },
      polish: { enabled: false, rulePresetId: 'general' },
    }),
    { rulePresetIds: ['general'] },
  );

  assert.deepEqual(settings.audio, {
    inputDevice: { id: 'mic-1', label: 'Blue Yeti' },
    outputDevice: { id: 'speaker-1', label: null },
  });
});

test('preserves legacy active prompt IDs as rule preset IDs when available', () => {
  const settings = normalizeAppSettings(
    parseAppSettingsFile({
      version: 1,
      auth: { providerId: 'openai-sub' },
      transcription: { providerId: 'openai-sub', model: 'chatgpt-backend-transcribe' },
      inference: { providerId: 'openai-sub', model: 'gpt-5.4-mini' },
      polish: { enabled: true, promptId: 'default' },
    }),
    { rulePresetIds: ['default', 'general'] },
  );

  assert.equal(settings.polish.rulePresetId, 'default');
});

test('rejects invalid settings structure', () => {
  assert.throws(() =>
    parseAppSettingsFile({
      version: 1,
      shortcut: { chord: { modifiers: ['control', 'alt'], key: 'Space' } },
      auth: { providerId: 'openai-sub' },
      transcription: { providerId: 'openai-sub', model: 'chatgpt-backend-transcribe' },
      inference: { providerId: 'openai-sub', model: 'gpt-5.4-mini' },
      polish: { enabled: 'yes', rulePresetId: 'general' },
    }),
  );
});
