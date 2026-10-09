import assert from 'node:assert/strict';
import test from 'node:test';

import type { DictionaryEntry } from '../../src/db/schema.ts';
import { defaultPolishRulePresets } from '../../src/polish/builtin-rules.ts';
import {
  ensureDictionaryEnabledLimit,
  maxEnabledDictionaryEntries,
  normalizeDictionaryEntryDraft,
  normalizeRulePresetDraft,
} from '../../src/polish/writing-drafts.ts';

function dictionaryEntry(id: string, enabled: boolean): DictionaryEntry {
  return {
    id,
    term: id,
    hint: null,
    enabled,
    createdAt: 1,
    updatedAt: 1,
  };
}

test('normalizes and bounds custom rule presets', () => {
  const normalized = normalizeRulePresetDraft({
    title: '  My rules  ',
    description: '  Crisp and clear.  ',
    body: '  - Keep it crisp.  ',
  });

  assert.equal(normalized.title, 'My rules');
  assert.equal(normalized.description, 'Crisp and clear.');
  assert.equal(normalized.body, '- Keep it crisp.');
  assert.match(normalized.bodyHash, /^[a-f0-9]{64}$/);
  assert.throws(
    () => normalizeRulePresetDraft({ title: 'x'.repeat(81), description: 'desc', body: 'body' }),
    /80 characters/,
  );
  assert.throws(
    () =>
      normalizeRulePresetDraft({ title: 'Title', description: 'desc', body: 'x'.repeat(12_001) }),
    /12000 characters/,
  );
});

test('accepts every shipped builtin rule preset body', () => {
  // The builtin presets are offered for editing in the settings UI, so a body the validator
  // rejects would be a preset the user cannot open and save.
  assert.ok(defaultPolishRulePresets.length > 0, 'expected builtin rule presets to exist');
  for (const { id, body } of defaultPolishRulePresets) {
    assert.doesNotThrow(
      () => normalizeRulePresetDraft({ title: id, description: id, body }),
      `builtin rule preset "${id}" is not accepted by the settings validator`,
    );
  }
});

test('normalizes and bounds dictionary entry drafts', () => {
  const normalized = normalizeDictionaryEntryDraft({
    term: '  Toph  ',
    hint: '  Sounds like toff.  ',
    enabled: true,
  });

  assert.deepEqual(normalized, { term: 'Toph', hint: 'Sounds like toff.', enabled: true });
  assert.throws(
    () => normalizeDictionaryEntryDraft({ term: 'x'.repeat(121), hint: null, enabled: true }),
    /120 characters/,
  );
  assert.throws(
    () => normalizeDictionaryEntryDraft({ term: 'Toph', hint: 'x'.repeat(501), enabled: true }),
    /500 characters/,
  );
});

test('enforces the enabled dictionary entry limit explicitly', () => {
  const entries = Array.from({ length: maxEnabledDictionaryEntries }, (_, index) =>
    dictionaryEntry(`entry-${index}`, true),
  );

  assert.throws(
    () => ensureDictionaryEnabledLimit({ entries, draft: { enabled: true } }),
    /200 dictionary entries/,
  );
  assert.doesNotThrow(() => ensureDictionaryEnabledLimit({ entries, draft: { enabled: false } }));
  assert.doesNotThrow(() =>
    ensureDictionaryEnabledLimit({ entries, draft: { enabled: true }, existingId: 'entry-0' }),
  );
});
