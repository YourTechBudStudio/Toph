import type { ReactNode } from 'react';

import type { ProviderConnection } from '@toph/desktop-contracts';

import { ProviderKindIcon, providerBillingLabel } from '../provider/provider-presentation';
import { ProviderStatusBadge } from '../provider/provider-status-badge';
import { SettingsIcon } from './settings-controls';

/** Identity and status for one provider: the always-visible part of its card. */
export function ProviderCardHeader({
  provider,
  action,
}: {
  provider: ProviderConnection;
  action?: ReactNode;
}) {
  const billing = providerBillingLabel(provider.billingMode);

  return (
    <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <SettingsIcon tone={provider.auth.kind === 'oauth' ? 'blue' : 'violet'}>
          <ProviderKindIcon provider={provider} />
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
