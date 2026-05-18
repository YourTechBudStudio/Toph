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
    polish: { enabled: true, rulePresetId: null },
    context: { screenshots: { enabled: false }, dictationPrompt: { enabled: false } },
    dashboard: { typingWpm: 50 },
    diagnostics: { enabled: false },
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
      context: { screenshots: { enabled: true }, dictationPrompt: { enabled: true } },
      diagnostics: { enabled: true },
    }),
    { rulePresetIds: ['general'] },
  );

  assert.deepEqual(settings.shortcut.chord, resolveDefaultShortcutChord(process.platform));
  assert.equal(settings.polish.enabled, false);
  assert.equal(settings.context.screenshots.enabled, true);
  assert.equal(settings.context.dictationPrompt.enabled, true);
  assert.equal(settings.diagnostics.enabled, true);
});

test('defaults Dictation Prompt to disabled when context settings are missing', () => {
  const settings = normalizeAppSettings(
    parseAppSettingsFile({
      version: 1,
      auth: { providerId: 'openai-sub' },
      transcription: { providerId: 'openai-sub', model: 'chatgpt-backend-transcribe' },
      inference: { providerId: 'openai-sub', model: 'gpt-5.4-mini' },
      polish: { enabled: true, rulePresetId: null },
    }),
    { rulePresetIds: ['general'] },
  );

  assert.equal(settings.context.dictationPrompt.enabled, false);
});

test('preserves Antigravity transcription and inference settings', () => {
  const settings = normalizeAppSettings(
    parseAppSettingsFile({
      version: 1,
      auth: { providerId: 'antigravity' },
      transcription: { providerId: 'antigravity', model: 'antigravity-gemini-3.1-flash-lite' },
      inference: { providerId: 'antigravity', model: 'antigravity-gemini-3.1-pro-high' },
      polish: { enabled: true, rulePresetId: null },
    }),
    { rulePresetIds: ['general'] },
  );

  assert.deepEqual(settings.auth, { providerId: 'antigravity' });
  assert.deepEqual(settings.transcription, {
    providerId: 'antigravity',
    model: 'antigravity-gemini-3.1-flash-lite',
  });
  assert.deepEqual(settings.inference, {
    providerId: 'antigravity',
    model: 'antigravity-gemini-3.1-pro-high',
  });
});

test('uses the Antigravity default transcription model when Antigravity transcription has an empty model', () => {
  const settings = normalizeAppSettings(
    parseAppSettingsFile({
      version: 1,
      auth: { providerId: 'openai-sub' },
      transcription: { providerId: 'antigravity', model: '   ' },
      inference: { providerId: 'openai-sub', model: 'gpt-5.4-mini' },
      polish: { enabled: true, rulePresetId: null },
    }),
    { rulePresetIds: ['general'] },
  );

  assert.deepEqual(settings.transcription, {
    providerId: 'antigravity',
    model: 'antigravity-gemini-3.1-flash-lite',
  });
});

test('uses the Antigravity default model when Antigravity inference has an empty model', () => {
  const settings = normalizeAppSettings(
    parseAppSettingsFile({
      version: 1,
      auth: { providerId: 'openai-sub' },
      transcription: { providerId: 'openai-sub', model: 'chatgpt-backend-transcribe' },
      inference: { providerId: 'antigravity', model: '   ' },
      polish: { enabled: true, rulePresetId: null },
    }),
    { rulePresetIds: ['general'] },
  );

  assert.deepEqual(settings.inference, {
    providerId: 'antigravity',
    model: 'antigravity-gemini-3.1-flash-lite',
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
