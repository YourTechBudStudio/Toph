import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import { shippedRulePresetBodyHashes } from './rule-preset-history';
import emailWritingRuleBody from './rules/email-writing';
import engineerRuleBody from './rules/engineer';
import generalRuleBody from './rules/general';

export const defaultPolishRulePresets = [
  {
    id: 'general',
    title: 'General',
    description: 'Clean up grammar and flow without stealing your voice.',
    body: generalRuleBody,
    bodyHash: createRulePresetHash(generalRuleBody),
    previousBodyHashes: shippedRulePresetBodyHashes.general,
  },
  {
    id: 'engineer',
    title: 'Engineer',
    description: 'Crisp, technical, and allergic to ambiguity.',
    body: engineerRuleBody,
    bodyHash: createRulePresetHash(engineerRuleBody),
    previousBodyHashes: shippedRulePresetBodyHashes.engineer,
  },
  {
    id: 'email-writing',
    title: 'Email & Writing',
    description: 'Polished enough for humans with inboxes.',
    body: emailWritingRuleBody,
    bodyHash: createRulePresetHash(emailWritingRuleBody),
    previousBodyHashes: shippedRulePresetBodyHashes['email-writing'],
  },
] as const;

/** SHA-256 of the UTF-8 body, as lowercase hex. Same output as desktop's former `node:crypto` hash. */
export function createRulePresetHash(body: string) {
  return bytesToHex(sha256(utf8ToBytes(body)));
}
