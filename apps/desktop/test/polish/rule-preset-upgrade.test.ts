import { strict as assert } from 'node:assert';
import test from 'node:test';

import { shippedRulePresetBodyHashes } from '../../src/main/polish/rule-preset-history.ts';
import { shouldUpgradeRulePresetBody } from '../../src/main/polish/rule-preset-upgrade.ts';

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
  // Editing a rules file fails here until its new hashes are recorded, because an unrecorded
  // predecessor strands every install still holding that body. Note the limit: this proves the
  // current hashes are present, not that they were appended. Replacing older entries instead of
  // appending would also satisfy it, and would silently strand the installs those entries cover.
  // `rule-preset-history.ts` tells contributors to append; nothing here can enforce it.
  const { createHash } = await import('node:crypto');
  const { readFile } = await import('node:fs/promises');
  const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

  const presetIds = Object.keys(shippedRulePresetBodyHashes);
  assert.ok(presetIds.length > 0, 'expected builtin rule presets to have a recorded hash history');

  for (const presetId of presetIds) {
    const recorded = shippedRulePresetBodyHashes[presetId];
    const body = await readFile(
      new URL(`../../src/main/polish/rules/${presetId}.txt`, import.meta.url),
      'utf8',
    );

    assert.ok(
      recorded.includes(hash(body)),
      `rules/${presetId}.txt was edited without appending its new hash to ` +
        `shippedRulePresetBodyHashes; existing installs would keep the old body forever`,
    );
    assert.ok(
      recorded.includes(hash(body.trim())),
      `rules/${presetId}.txt is missing the trimmed hash of its current body, which is the ` +
        `spelling stored when a preset is saved through the settings UI`,
    );
    assert.equal(new Set(recorded).size, recorded.length, `duplicate hashes for ${presetId}`);
  }
});
