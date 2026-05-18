import { createHash } from 'node:crypto';

import emailWritingRuleBody from './rules/email-writing.txt?raw';
import engineerRuleBody from './rules/engineer.txt?raw';
import fundraisingRuleBody from './rules/fundraising.txt?raw';
import generalRuleBody from './rules/general.txt?raw';

export const defaultPolishRulePresets = [
  {
    id: 'general',
    title: 'General',
    description: 'Clean up grammar and flow without stealing your voice.',
    body: generalRuleBody,
    bodyHash: createRulePresetHash(generalRuleBody),
  },
  {
    id: 'engineer',
    title: 'Engineer',
    description: 'Crisp, technical, and allergic to ambiguity.',
    body: engineerRuleBody,
    bodyHash: createRulePresetHash(engineerRuleBody),
  },
  {
    id: 'email-writing',
    title: 'Email & Writing',
    description: 'Polished enough for humans with inboxes.',
    body: emailWritingRuleBody,
    bodyHash: createRulePresetHash(emailWritingRuleBody),
  },
  {
    id: 'fundraising',
    title: 'Fundraising',
    description: 'Investor-ready without making things up.',
    body: fundraisingRuleBody,
    bodyHash: createRulePresetHash(fundraisingRuleBody),
  },
] as const;

export function createRulePresetHash(body: string) {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}
