import { Bot, KeyRound } from 'lucide-react';
import type { ReactNode } from 'react';

import type { ProviderBillingMode, ProviderConnection } from '@toph/desktop-contracts';

import { ProviderStatusBadge } from './provider-status-badge';
import { SettingsIcon } from './settings-controls';

const billingLabel: Record<ProviderBillingMode, string> = {
  subscription: 'Subscription',
  metered: 'Pay as you go',
  local: 'Runs locally',
  unknown: '',
};

/** Identity and status for one provider: the always-visible part of its card. */
export function ProviderCardHeader({
  provider,
  action,
}: {
  provider: ProviderConnection;
  action?: ReactNode;
}) {
  const billing = billingLabel[provider.billingMode];

  return (
    <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <SettingsIcon tone={provider.auth.kind === 'oauth' ? 'blue' : 'violet'}>
          {provider.auth.kind === 'oauth' ? (
            <Bot size={17} strokeWidth={1.8} />
          ) : (
            <KeyRound size={17} strokeWidth={1.8} />
          )}
        </SettingsIcon>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-text-primary">{provider.label}</div>
          {billing && <div className="text-xs leading-relaxed text-text-tertiary">{billing}</div>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <ProviderStatusBadge status={provider.status} />
        {action}
      </div>
    </div>
  );
}
