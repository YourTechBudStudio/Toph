import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createRulePresetHash, defaultPolishRulePresets } from '../../src/polish/builtin-rules.ts';
import { shippedRulePresetBodyHashes } from '../../src/polish/rule-preset-history.ts';
import { shouldUpgradeRulePresetBody } from '../../src/polish/rule-preset-upgrade.ts';

/** The hash desktop shipped with before core owned it, kept as the oracle. */
const nodeHash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

const previousBodyHashes = ['previous-untrimmed-hash', 'previous-trimmed-hash'];

test('upgrades when the stored body is text a previous release shipped', () => {
  assert.equal(
    shouldUpgradeRulePresetBody({
      storedBodyHash: 'previous-untrimmed-hash',
      incomingBodyHash: 'incoming-hash',
      previousBodyHashes,
    }),
    true,
  );
});

test('upgrades when the stored body is a previous release saved through the settings UI', () => {
  // `normalizeRulePresetDraft` hashes the trimmed body, so an unchanged save through the UI
  // stores a different hash than `createRulePresetHash` produces for the same shipped file.
  assert.equal(
    shouldUpgradeRulePresetBody({
      storedBodyHash: 'previous-trimmed-hash',
      incomingBodyHash: 'incoming-hash',
      previousBodyHashes,
    }),
    true,
  );
});

test('normalizes a stored trimmed hash of the body this build ships', () => {
  // The history list deliberately includes the current body's hashes too. Stored-equals-incoming
  // short-circuits first, so the current untrimmed hash is inert; the current *trimmed* hash is
  // not, and matching it rewrites the stored hash to the untrimmed spelling. That is self-healing:
  // a user who saved the current preset unchanged through the settings UI is put back on the
  // spelling future releases match against, instead of being stranded as "user-edited".
  assert.equal(
    shouldUpgradeRulePresetBody({
      storedBodyHash: 'current-trimmed-hash',
      incomingBodyHash: 'current-untrimmed-hash',
      previousBodyHashes: ['current-untrimmed-hash', 'current-trimmed-hash'],
    }),
    true,
  );
});

test('does nothing when the stored body already matches the incoming body', () => {
  assert.equal(
    shouldUpgradeRulePresetBody({
      storedBodyHash: 'incoming-hash',
      incomingBodyHash: 'incoming-hash',
      previousBodyHashes,
    }),
    false,
  );
});

test('leaves a user-edited body alone', () => {
  assert.equal(
    shouldUpgradeRulePresetBody({
      storedBodyHash: 'the-user-wrote-this',
      incomingBodyHash: 'incoming-hash',
      previousBodyHashes,
    }),
    false,
  );
});

test('leaves any stored body alone when no previous hashes are declared', () => {
  assert.equal(
    shouldUpgradeRulePresetBody({
      storedBodyHash: 'anything',
      incomingBodyHash: 'incoming-hash',
      previousBodyHashes: [],
    }),
    false,
  );
});

test('every shipped rule preset body is recorded in its hash history', async () => {
  // Editing a rule module fails here until its new hashes are recorded, because an unrecorded
  // predecessor strands every install still holding that body. Note the limit: this proves the
  // current hashes are present, not that they were appended. Replacing older entries instead of
  // appending would also satisfy it, and would silently strand the installs those entries cover.
  // `rule-preset-history.ts` tells contributors to append; nothing here can enforce it.
  assert.ok(defaultPolishRulePresets.length > 0, 'expected builtin rule presets to exist');

  for (const { id: presetId, body } of defaultPolishRulePresets) {
    const recorded = shippedRulePresetBodyHashes[presetId];

    assert.ok(
      recorded.includes(nodeHash(body)),
      `rules/${presetId}.ts was edited without appending its new hash to ` +
        `shippedRulePresetBodyHashes; existing installs would keep the old body forever`,
    );
    assert.ok(
      recorded.includes(nodeHash(body.trim())),
      `rules/${presetId}.ts is missing the trimmed hash of its current body, which is the ` +
        `spelling stored when a preset is saved through the settings UI`,
    );
    assert.equal(new Set(recorded).size, recorded.length, `duplicate hashes for ${presetId}`);
  }
});

test('every builtin rule preset carries the node:crypto hash of its body', () => {
  for (const preset of defaultPolishRulePresets) {
    assert.equal(preset.bodyHash, nodeHash(preset.body), `bodyHash mismatch for ${preset.id}`);
  }
});

test('createRulePresetHash matches node:crypto, including non-ASCII and lone surrogates', () => {
  for (const text of ['', 'Toph', 'naïve café — 日本語 🎙️', '\ud800']) {
    assert.equal(createRulePresetHash(text), nodeHash(text), JSON.stringify(text));
  }
});
