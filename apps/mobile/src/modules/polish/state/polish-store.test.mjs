/**
 * The polish store with fake storage: loading order and failure, the seeding save, last-edit-wins
 * settings writes, the one-at-a-time row edits, and the refresh failure after a committed write.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { createPolishStore, parseStoredPolishSettings } from './polish-store.ts';

const seededSettings = { enabled: false, rulePresetId: 'engineer', dictionaryDefaultsSeeded: true };

const preset = {
  id: 'general',
  title: 'General',
  description: 'Clean up grammar.',
  body: 'Rules.',
  bodyHash: 'hash',
  isBuiltin: false,
  sortOrder: 0,
  createdAt: 1,
  updatedAt: 1,
};

/** Lets every promise callback that is already queued run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** In-memory polish tables with desktop's ordering. `failNext` makes one named method reject once. */
function fakeTables({ presets = [preset], dictionary = [] } = {}) {
  let rows = { presets: [...presets], dictionary: [...dictionary] };
  let nextId = 1;
  const failures = new Map();
  const calls = [];
  const guard = (name) => {
    calls.push(name);
    const failure = failures.get(name);
    if (failure !== undefined) {
      failures.delete(name);
      throw failure;
    }
  };
  return {
    calls,
    failNext(name, error) {
      failures.set(name, error);
    },
    tables: {
      async syncBuiltinPolishRulePresets() {
        guard('syncBuiltinPolishRulePresets');
      },
      async listPolishRulePresets() {
        guard('listPolishRulePresets');
        return [...rows.presets];
      },
      async getPolishRulePreset(id) {
        guard('getPolishRulePreset');
        return rows.presets.find((row) => row.id === id) ?? null;
      },
      async updatePolishRulePreset(id, draft) {
        guard('updatePolishRulePreset');
        rows.presets = rows.presets.map((row) => (row.id === id ? { ...row, ...draft } : row));
      },
      async listDictionaryEntries() {
        guard('listDictionaryEntries');
        return [...rows.dictionary].sort((a, b) => a.term.localeCompare(b.term));
      },
      async createDictionaryEntry(draft) {
        guard('createDictionaryEntry');
        const created = { id: `entry_${String(nextId++)}`, ...draft, createdAt: 1, updatedAt: 1 };
        rows.dictionary.push(created);
        return created;
      },
      async updateDictionaryEntry(id, draft) {
        guard('updateDictionaryEntry');
        const existing = rows.dictionary.find((row) => row.id === id);
        const updated = { ...existing, ...draft };
        rows.dictionary = rows.dictionary.map((row) => (row.id === id ? updated : row));
        return updated;
      },
      async deleteDictionaryEntry(id) {
        guard('deleteDictionaryEntry');
        rows.dictionary = rows.dictionary.filter((row) => row.id !== id);
      },
    },
  };
}

/**
 * Fake deps. Saves are held, as the real SecureStore queue holds them: each `read` is called only
 * when the test runs `flushSaves()`, so the test can check what a queued write would save.
 */
function fakeDeps({ settings = seededSettings, tables = fakeTables(), openTables } = {}) {
  const pending = [];
  const saved = [];
  return {
    tables,
    saved,
    pendingSaves: () => pending.length,
    flushSaves() {
      for (const read of pending.splice(0)) {
        saved.push(read());
      }
    },
    deps: {
      openTables: openTables ?? (async () => tables.tables),
      readSettings: async () => settings,
      saveSettings: (read) => {
        pending.push(read);
        return Promise.resolve(true);
      },
    },
  };
}

function entry(term, enabled = true) {
  return { id: `id_${term}`, term, hint: null, enabled, createdAt: 1, updatedAt: 1 };
}

// A storage failure is logged by design; keep the test output readable.
beforeEach(() => {
  mock.method(console, 'warn', () => {});
});
afterEach(() => {
  mock.restoreAll();
});

describe('polish store loading', () => {
  it('applies the saved settings and lists the tables', async () => {
    const fake = fakeDeps({ tables: fakeTables({ dictionary: [entry('Toph')] }) });
    const { usePolishStore, loadPolish, polishSources } = createPolishStore(fake.deps);

    await loadPolish();

    const state = usePolishStore.getState();
    assert.equal(state.loaded, true);
    assert.equal(state.storageError, null);
    assert.equal(state.enabled, false);
    assert.equal(state.activePresetId, 'engineer');
    assert.deepEqual(state.presets, [preset]);
    assert.deepEqual(
      state.dictionary.map((row) => row.term),
      ['Toph'],
    );
    assert.deepEqual(fake.tables.calls.slice(0, 1), ['syncBuiltinPolishRulePresets']);
    assert.deepEqual(polishSources.getSettings(), {
      polish: { enabled: false, rulePresetId: 'engineer' },
    });
    await polishSources.ready();
  });

  it('settles with the storage error when the database cannot open', async () => {
    const fake = fakeDeps({
      openTables: () => Promise.reject(new Error('database is locked')),
    });
    const { usePolishStore, loadPolish, polishSources } = createPolishStore(fake.deps);

    await loadPolish();

    const state = usePolishStore.getState();
    assert.equal(state.loaded, true);
    assert.equal(state.storageError, 'database is locked');
    assert.deepEqual(state.presets, []);
    assert.deepEqual(state.dictionary, []);
    // The saved switch survives a broken database.
    assert.equal(state.enabled, false);
    await assert.rejects(polishSources.ready(), { message: 'database is locked' });
    await assert.rejects(polishSources.listDictionaryEntries(), { message: 'database is locked' });
  });

  it('settles with the storage error when syncing the built-in presets throws', async () => {
    const tables = fakeTables({ dictionary: [entry('Toph')] });
    tables.failNext('syncBuiltinPolishRulePresets', new Error('disk I/O error'));
    const { usePolishStore, loadPolish, polishSources } = createPolishStore(
      fakeDeps({ tables }).deps,
    );

    await loadPolish();

    const state = usePolishStore.getState();
    assert.equal(state.loaded, true);
    assert.equal(state.storageError, 'disk I/O error');
    assert.deepEqual(state.presets, []);
    assert.deepEqual(state.dictionary, []);
    await assert.rejects(polishSources.ready(), { message: 'disk I/O error' });
  });

  it('seeds the dictionary once and the queued save keeps the saved settings', async () => {
    const fake = fakeDeps({
      settings: { enabled: false, rulePresetId: 'engineer', dictionaryDefaultsSeeded: false },
    });
    const { usePolishStore, loadPolish } = createPolishStore(fake.deps);

    await Promise.all([loadPolish(), loadPolish()]);
    assert.equal(fake.pendingSaves(), 1);
    fake.flushSaves();

    assert.deepEqual(fake.saved, [
      { enabled: false, rulePresetId: 'engineer', dictionaryDefaultsSeeded: true },
    ]);
    assert.deepEqual(
      usePolishStore.getState().dictionary.map((row) => row.term),
      ['Isagi', 'Toph'],
    );
    assert.equal(fake.tables.calls.filter((name) => name === 'createDictionaryEntry').length, 2);
  });

  it('does not save or claim seeding when seeding fails', async () => {
    const tables = fakeTables();
    tables.failNext('createDictionaryEntry', new Error('constraint failed'));
    const fake = fakeDeps({
      tables,
      settings: { enabled: true, rulePresetId: 'general', dictionaryDefaultsSeeded: false },
    });
    const { usePolishStore, loadPolish } = createPolishStore(fake.deps);

    await loadPolish();
    assert.equal(usePolishStore.getState().storageError, 'constraint failed');
    assert.equal(fake.pendingSaves(), 0);

    usePolishStore.getState().setEnabled(false);
    fake.flushSaves();
    assert.equal(fake.saved[0].dictionaryDefaultsSeeded, false);
  });

  it('uses the defaults when nothing is saved', async () => {
    const fake = fakeDeps({ settings: null });
    const { usePolishStore, loadPolish } = createPolishStore(fake.deps);

    await loadPolish();

    assert.equal(usePolishStore.getState().enabled, true);
    assert.equal(usePolishStore.getState().activePresetId, null);
  });
});

describe('polish settings switches', () => {
  it('enqueues one write per change, each saving the latest values', async () => {
    const fake = fakeDeps();
    const { usePolishStore, loadPolish } = createPolishStore(fake.deps);
    await loadPolish();

    usePolishStore.getState().setEnabled(true);
    usePolishStore.getState().setEnabled(false);
    assert.equal(usePolishStore.getState().enabled, false);
    assert.equal(fake.pendingSaves(), 2);
    fake.flushSaves();

    const latest = { enabled: false, rulePresetId: 'engineer', dictionaryDefaultsSeeded: true };
    assert.deepEqual(fake.saved, [latest, latest]);
  });

  it('applies the active preset at once and to the sources', async () => {
    const fake = fakeDeps();
    const { usePolishStore, loadPolish, polishSources } = createPolishStore(fake.deps);
    await loadPolish();

    usePolishStore.getState().setActivePreset('general');

    assert.equal(polishSources.getSettings().polish.rulePresetId, 'general');
    fake.flushSaves();
    assert.equal(fake.saved[0].rulePresetId, 'general');
  });
});

describe('polish row edits', () => {
  it('lets only one of two concurrent adds pass the enabled limit', async () => {
    const dictionary = Array.from({ length: 199 }, (_, index) => entry(`term${String(index)}`));
    const fake = fakeDeps({ tables: fakeTables({ dictionary }) });
    const { usePolishStore, loadPolish } = createPolishStore(fake.deps);
    await loadPolish();

    const results = await Promise.allSettled([
      usePolishStore.getState().addEntry('Alpha', ''),
      usePolishStore.getState().addEntry('Beta', ''),
    ]);

    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected');
    assert.equal(results[1].reason.message, 'Only 200 dictionary entries can be enabled at once.');
    assert.equal(usePolishStore.getState().dictionary.length, 200);
  });

  it('checks the limit against the tables and leaves state unchanged on rejection', async () => {
    const tables = fakeTables({ dictionary: [entry('Toph')] });
    const fake = fakeDeps({ tables });
    const { usePolishStore, loadPolish } = createPolishStore(fake.deps);
    await loadPolish();
    const before = usePolishStore.getState().dictionary;
    // The tables now hold more enabled entries than state shows.
    for (let index = 0; index < 200; index += 1) {
      await tables.tables.createDictionaryEntry({
        term: `t${String(index)}`,
        hint: null,
        enabled: true,
      });
    }

    await assert.rejects(usePolishStore.getState().addEntry('Gamma', 'hint'), {
      message: 'Only 200 dictionary entries can be enabled at once.',
    });
    assert.equal(usePolishStore.getState().dictionary, before);
  });

  it('rejects a preset edit with the validator message', async () => {
    const { usePolishStore, loadPolish } = createPolishStore(fakeDeps().deps);
    await loadPolish();

    await assert.rejects(
      usePolishStore.getState().updatePreset('general', {
        title: 'General',
        description: '   ',
        body: 'Rules.',
      }),
      { message: 'Rule preset description is required.' },
    );
  });

  it('saves a preset edit trimmed and re-reads the list', async () => {
    const { usePolishStore, loadPolish } = createPolishStore(fakeDeps().deps);
    await loadPolish();

    await usePolishStore.getState().updatePreset('general', {
      title: ' Mine ',
      description: 'Mine.',
      body: ' New rules. ',
    });

    const [updated] = usePolishStore.getState().presets;
    assert.equal(updated.title, 'Mine');
    assert.equal(updated.body, 'New rules.');
    assert.match(updated.bodyHash, /^[0-9a-f]{64}$/);
  });

  it('reports a committed write whose re-read failed, and the sources see the write', async () => {
    const tables = fakeTables({ dictionary: [entry('Toph')] });
    const { usePolishStore, loadPolish, polishSources } = createPolishStore(
      fakeDeps({ tables }).deps,
    );
    await loadPolish();
    const before = usePolishStore.getState().dictionary;

    // `setEntryEnabled` lists once to validate, then once to refresh; fail the refresh.
    const list = tables.tables.listDictionaryEntries;
    let reads = 0;
    tables.tables.listDictionaryEntries = async () => {
      reads += 1;
      if (reads === 2) {
        throw new Error('database is locked');
      }
      return list();
    };

    await assert.rejects(usePolishStore.getState().setEntryEnabled('id_Toph', false), {
      message: 'Saved, but the list could not be refreshed: database is locked',
    });
    assert.equal(usePolishStore.getState().dictionary, before);
    const [row] = await polishSources.listDictionaryEntries();
    assert.equal(row.enabled, false);
  });

  it('keeps running edits after a failed one', async () => {
    const { usePolishStore, loadPolish } = createPolishStore(fakeDeps().deps);
    await loadPolish();

    const failed = usePolishStore.getState().setEntryEnabled('missing', true);
    const added = usePolishStore.getState().addEntry('Toph', '');

    await assert.rejects(failed, { message: 'Dictionary entry "missing" is not available.' });
    await added;
    await settle();
    assert.deepEqual(
      usePolishStore.getState().dictionary.map((row) => row.term),
      ['Toph'],
    );
  });

  it('removes an entry and re-reads the list', async () => {
    const tables = fakeTables({ dictionary: [entry('Toph'), entry('Expo')] });
    const { usePolishStore, loadPolish } = createPolishStore(fakeDeps({ tables }).deps);
    await loadPolish();

    await usePolishStore.getState().removeEntry('id_Expo');

    assert.deepEqual(
      usePolishStore.getState().dictionary.map((row) => row.term),
      ['Toph'],
    );
  });
});

describe('parseStoredPolishSettings', () => {
  it('reads a saved entry', () => {
    assert.deepEqual(parseStoredPolishSettings(JSON.stringify(seededSettings)), seededSettings);
    assert.deepEqual(
      parseStoredPolishSettings(
        JSON.stringify({ enabled: true, rulePresetId: null, dictionaryDefaultsSeeded: false }),
      ),
      { enabled: true, rulePresetId: null, dictionaryDefaultsSeeded: false },
    );
  });

  it('rejects missing, non-JSON and wrongly shaped entries', () => {
    for (const raw of [
      null,
      'not json',
      'null',
      '[]',
      '"general"',
      JSON.stringify({ enabled: 'yes', rulePresetId: null, dictionaryDefaultsSeeded: false }),
      JSON.stringify({ enabled: true, rulePresetId: 3, dictionaryDefaultsSeeded: false }),
      JSON.stringify({ enabled: true, rulePresetId: null }),
    ]) {
      assert.equal(parseStoredPolishSettings(raw), null, String(raw));
    }
  });
});
