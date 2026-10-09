import { asc, eq } from 'drizzle-orm';

import {
  createId,
  defaultPolishRulePresets,
  dictionaryEntries,
  polishRulePresets,
  shouldUpgradeRulePresetBody,
  type DictionaryEntry,
  type DictionarySeedStore,
  type PolishRulePreset,
  type PolishRulesStore,
} from '@toph/dictation-core';

import type { TophDatabase } from '../../../storage/database';

/**
 * The polish rows in the app's database, with desktop's store method names and ordering. The
 * methods are async in shape over drizzle's synchronous calls, so the object satisfies core's
 * `PolishRulesStore` and `DictionarySeedStore` directly.
 */
export interface PolishTables extends PolishRulesStore, DictionarySeedStore {
  /** Inserts missing built-in presets (sortOrder = index) and upgrades untouched shipped bodies. */
  syncBuiltinPolishRulePresets: () => Promise<void>;
  /** By sort order, then title, as desktop lists them. */
  listPolishRulePresets: () => Promise<PolishRulePreset[]>;
  updatePolishRulePreset: (
    id: string,
    draft: { title: string; description: string; body: string; bodyHash: string },
  ) => Promise<void>;
  deleteDictionaryEntry: (id: string) => Promise<void>;
}

export function createPolishTables(db: TophDatabase): PolishTables {
  const getPreset = (id: string) =>
    db.select().from(polishRulePresets).where(eq(polishRulePresets.id, id)).get() ?? null;
  const getEntry = (id: string) =>
    db.select().from(dictionaryEntries).where(eq(dictionaryEntries.id, id)).get() ?? null;

  return {
    async syncBuiltinPolishRulePresets() {
      for (const [index, preset] of defaultPolishRulePresets.entries()) {
        const now = Date.now();
        const existing = getPreset(preset.id);
        if (existing === null) {
          // Desktop writes shipped presets with `isBuiltin: false` too; the flag is unused.
          db.insert(polishRulePresets)
            .values({
              id: preset.id,
              title: preset.title,
              description: preset.description,
              body: preset.body,
              bodyHash: preset.bodyHash,
              isBuiltin: false,
              sortOrder: index,
              createdAt: now,
              updatedAt: now,
            })
            .run();
          continue;
        }
        // Replace the body only when the stored one is untouched shipped text, so a user's own
        // edits are never clobbered. Desktop's legacy description and sort-order fills are not
        // needed: mobile has no older rows.
        const upgrade = shouldUpgradeRulePresetBody({
          storedBodyHash: existing.bodyHash,
          incomingBodyHash: preset.bodyHash,
          previousBodyHashes: preset.previousBodyHashes,
        });
        if (upgrade) {
          db.update(polishRulePresets)
            .set({ body: preset.body, bodyHash: preset.bodyHash, updatedAt: now })
            .where(eq(polishRulePresets.id, preset.id))
            .run();
        }
      }
    },

    async listPolishRulePresets() {
      return db
        .select()
        .from(polishRulePresets)
        .orderBy(asc(polishRulePresets.sortOrder), asc(polishRulePresets.title))
        .all();
    },

    async getPolishRulePreset(id) {
      return getPreset(id);
    },

    async updatePolishRulePreset(id, draft) {
      if (getPreset(id) === null) {
        throw new Error(`Polish rule preset "${id}" is not available.`);
      }
      db.update(polishRulePresets)
        .set({ ...draft, updatedAt: Date.now() })
        .where(eq(polishRulePresets.id, id))
        .run();
    },

    async listDictionaryEntries() {
      return db.select().from(dictionaryEntries).orderBy(asc(dictionaryEntries.term)).all();
    },

    async createDictionaryEntry(draft) {
      const now = Date.now();
      const entry: DictionaryEntry = {
        id: createId('dictionary_entry'),
        term: draft.term,
        hint: draft.hint,
        enabled: draft.enabled,
        createdAt: now,
        updatedAt: now,
      };
      db.insert(dictionaryEntries).values(entry).run();
      return entry;
    },

    async updateDictionaryEntry(id, draft) {
      const existing = getEntry(id);
      if (existing === null) {
        throw new Error(`Dictionary entry "${id}" is not available.`);
      }
      const updated: DictionaryEntry = {
        ...existing,
        term: draft.term,
        hint: draft.hint,
        enabled: draft.enabled,
        updatedAt: Date.now(),
      };
      db.update(dictionaryEntries)
        .set({
          term: updated.term,
          hint: updated.hint,
          enabled: updated.enabled,
          updatedAt: updated.updatedAt,
        })
        .where(eq(dictionaryEntries.id, id))
        .run();
      return updated;
    },

    async deleteDictionaryEntry(id) {
      db.delete(dictionaryEntries).where(eq(dictionaryEntries.id, id)).run();
    },
  };
}
