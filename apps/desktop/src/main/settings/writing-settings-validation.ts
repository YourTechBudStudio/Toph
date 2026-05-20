import { createHash } from 'node:crypto';

import {
  MAX_ENABLED_DICTIONARY_ENTRIES,
  type DictionaryEntryDraft,
  type PolishRulePresetDraft,
} from '@toph/desktop-contracts';

import type { DictionaryEntry } from '../db/schema';

const maxRulePresetTitleLength = 80;
const maxRulePresetDescriptionLength = 180;
const maxRulePresetBodyLength = 4_000;
const maxDictionaryTermLength = 120;
const maxDictionaryHintLength = 500;
export const maxEnabledDictionaryEntries = MAX_ENABLED_DICTIONARY_ENTRIES;

function createRulePresetHash(body: string) {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

export function normalizeRulePresetDraft(draft: PolishRulePresetDraft) {
  const title = draft.title.trim();
  const description = draft.description.trim();
  const body = draft.body.trim();
  if (!title) {
    throw new Error('Rule preset title is required.');
  }
  if (!description) {
    throw new Error('Rule preset description is required.');
  }
  if (!body) {
    throw new Error('Rule preset body is required.');
  }
  if (title.length > maxRulePresetTitleLength) {
    throw new Error(`Rule preset titles must be ${maxRulePresetTitleLength} characters or fewer.`);
  }
  if (body.length > maxRulePresetBodyLength) {
    throw new Error(`Rule preset bodies must be ${maxRulePresetBodyLength} characters or fewer.`);
  }
  if (description.length > maxRulePresetDescriptionLength) {
    throw new Error(
      `Rule preset descriptions must be ${maxRulePresetDescriptionLength} characters or fewer.`,
    );
  }

  return { title, description, body, bodyHash: createRulePresetHash(body) };
}

export function normalizeDictionaryEntryDraft(draft: DictionaryEntryDraft) {
  const term = draft.term.trim();
  const hint = draft.hint?.trim() || null;
  if (!term) {
    throw new Error('Dictionary term is required.');
  }
  if (term.length > maxDictionaryTermLength) {
    throw new Error(`Dictionary terms must be ${maxDictionaryTermLength} characters or fewer.`);
  }
  if (hint && hint.length > maxDictionaryHintLength) {
    throw new Error(`Dictionary hints must be ${maxDictionaryHintLength} characters or fewer.`);
  }

  return { term, hint, enabled: draft.enabled };
}

export function ensureDictionaryEnabledLimit(options: {
  entries: DictionaryEntry[];
  draft: { enabled: boolean };
  existingId?: string;
}) {
  if (!options.draft.enabled) {
    return;
  }

  const enabledCount = options.entries.filter(
    (entry) => entry.enabled && entry.id !== options.existingId,
  ).length;
  if (enabledCount >= maxEnabledDictionaryEntries) {
    throw new Error(
      `Only ${maxEnabledDictionaryEntries} dictionary entries can be enabled at once.`,
    );
  }
}
