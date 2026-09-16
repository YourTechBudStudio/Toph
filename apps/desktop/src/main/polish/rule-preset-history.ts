/**
 * Every body hash this app has ever shipped for each builtin rule preset, oldest first.
 *
 * `syncDefaultPolishRulePreset` upgrades a stored preset body only when its hash appears here,
 * which is what distinguishes untouched shipped text from the user's own edits. Dropping a hash
 * strands every install still holding that body on an old prompt, silently.
 *
 * Each shipped body contributes TWO entries: `createRulePresetHash` in `builtin-rules.ts` hashes
 * the untrimmed `?raw` file, while `normalizeRulePresetDraft` hashes the trimmed body when a
 * preset is saved through the settings UI. Both spellings mean "untouched shipped text".
 *
 * The final entries are the body this build ships. `rule-preset-upgrade.test.ts` asserts the
 * current rules files hash to entries present here, so editing a rules file without touching this
 * list fails the suite. When that happens, APPEND the new hashes — never replace the last ones,
 * or the body users are still holding stops being recognised. The test cannot tell appending from
 * replacing, so that part is on you.
 *
 * This is a separate module because `builtin-rules.ts` uses Vite `?raw` imports and cannot be
 * loaded by the desktop test runner, which leaves this list untestable if it lives there.
 */
export const shippedRulePresetBodyHashes: Record<string, readonly string[]> = {
  general: [
    // Shipped since the preset was introduced.
    '3c306a6a007f94607e78c730fa625e5c6a8ff01a540427963ac76b0ab931766c',
    '2209afb1f8f6ded130c016cacf6f2f09757de8181dc981fd571ac3c69d027c76',
  ],
  engineer: [
    // Original body, superseded by the evaluated prompt split in phase 01.
    '11dd3f93c6d5300b64367ec75e1932051fbbe47a29c9583bb3f7936fe0af1264',
    'd39816dfef4ea2c13c6072bc4be012bbe86469faeba4e80622f3383e3fa9155f',
    // Current: the evaluated candidate's technical, structure, and example sections.
    'cdf72da1c6048eb4735d758c23fed3f23930215e1affaf22fd295952c92affcf',
    '1be275e812be801498992413bf2a3c76a4cbabf722f7dcb9f308c82916c38cd3',
  ],
  'email-writing': [
    // Shipped since the preset was introduced.
    '7789154f1f80881e24d6c5f0ec05fecb8d86a01833e42a66151f0ef4fb347929',
    '4403a56da1279b37ad04bef686a8c7500235baa2c4ba82e8da90e3aee6fabd93',
  ],
};
