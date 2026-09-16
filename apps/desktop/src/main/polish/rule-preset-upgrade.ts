/**
 * Decides whether a builtin rule preset's stored body may be replaced by the body this build
 * ships. A stored body is only replaceable when it is untouched shipped text, which is true when
 * its hash matches a body some release of this app shipped. Anything else is the user's own
 * writing and is never clobbered.
 *
 * This lives apart from `builtin-rules.ts` because that module uses Vite `?raw` imports and so
 * cannot be loaded by the desktop test runner. Hashes in, decision out, nothing else.
 */
export function shouldUpgradeRulePresetBody(input: {
  storedBodyHash: string;
  incomingBodyHash: string;
  previousBodyHashes: readonly string[];
}) {
  if (input.storedBodyHash === input.incomingBodyHash) {
    return false;
  }

  return input.previousBodyHashes.includes(input.storedBodyHash);
}
