import assert from 'node:assert/strict';
import test from 'node:test';

import type { DictionaryEntry } from '../../src/main/db/schema.ts';
import {
  ensureDictionaryEnabledLimit,
  maxEnabledDictionaryEntries,
  normalizeDictionaryEntryDraft,
  normalizeRulePresetDraft,
} from '../../src/main/settings/writing-settings-validation.ts';

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
    description: '  Custom dictation polish rules.  ',
    body: '  - Keep it crisp.  ',
  });

  assert.equal(normalized.title, 'My rules');
  assert.equal(normalized.description, 'Custom dictation polish rules.');
  assert.equal(normalized.body, '- Keep it crisp.');
  assert.match(normalized.bodyHash, /^[a-f0-9]{64}$/);
  assert.throws(
    () =>
      normalizeRulePresetDraft({
        title: 'x'.repeat(81),
        description: 'Description',
        body: 'body',
      }),
    /80 characters/,
  );
  assert.throws(
    () =>
      normalizeRulePresetDraft({
        title: 'Title',
        description: 'Description',
        body: 'x'.repeat(4_001),
      }),
    /4000 characters/,
  );
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
