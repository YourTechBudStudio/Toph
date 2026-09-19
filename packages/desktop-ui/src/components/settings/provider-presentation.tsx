import { Bot, KeyRound } from 'lucide-react';

import type {
  ProviderBillingMode,
  ProviderConnection,
  ProviderRole,
} from '@toph/desktop-contracts';

/** What each role is called wherever it is named to the user. */
export const providerRoleLabel: Record<ProviderRole, string> = {
  transcription: 'Transcription',
  inference: 'Polishing',
};

const billingLabel: Record<ProviderBillingMode, string> = {
  subscription: 'Subscription',
  metered: 'Pay as you go',
  local: 'Runs locally',
  unknown: '',
};

/**
 * How a provider bills, in the user's words. Empty when the mode says nothing worth printing, so
 * callers filter rather than render a blank line.
 */
export function providerBillingLabel(mode: ProviderBillingMode) {
  return billingLabel[mode];
}

/**
 * What a provider looks like: a signed-in account or a key you hold. Settings and onboarding must
 * present providers identically, so the glyph is chosen once, from the declared auth kind.
 */
export function ProviderKindIcon({
  provider,
  size = 17,
}: {
  provider: ProviderConnection;
  size?: number;
}) {
  return provider.auth.kind === 'oauth' ? (
    <Bot size={size} strokeWidth={1.8} />
  ) : (
    <KeyRound size={size} strokeWidth={1.8} />
  );
}
