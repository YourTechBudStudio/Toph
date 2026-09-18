import { useState } from 'react';

import type {
  ProviderConnection,
  ProviderFieldValue,
  ProviderSettingsValues,
} from '@toph/desktop-contracts';

import { Button } from '../button';
import { ProviderCardHeader } from './provider-card-header';
import { ProviderConnectionForm } from './provider-connection-form';

/**
 * One provider's card. The connection UI expands in place, driven by an explicit button rather than
 * a disclosure chevron: setting a provider up is an action you take, not a detail you unfold.
 */
export function ProviderConnectionCard({
  provider,
  settings,
  busy,
  onConnect,
  onRemove,
  onSettingChange,
}: {
  provider: ProviderConnection;
  settings: ProviderSettingsValues;
  busy: boolean;
  onConnect: (values: Record<string, string>) => void;
  onRemove: () => void;
  onSettingChange: (key: string, value: ProviderFieldValue) => void;
}) {
  // Only a broken connection opens itself. An unused provider stays quiet.
  const demandsAttention = provider.status === 'invalid' || provider.status === 'connecting';
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const open = openOverride ?? demandsAttention;

  return (
    <div className="border-b border-white/5 last:border-b-0">
      <ProviderCardHeader
        provider={provider}
        action={
          <Button
            variant="secondary"
            className="px-3 py-1.5"
            onClick={() => setOpenOverride(!open)}
          >
            {open ? 'Close' : provider.status === 'connected' ? 'Manage' : 'Set up'}
          </Button>
        }
      />

      {open && (
        <div className="border-t border-white/5 bg-white/2">
          <ProviderConnectionForm
            provider={provider}
            settings={settings}
            busy={busy}
            onConnect={onConnect}
            onRemove={onRemove}
            onSettingChange={onSettingChange}
          />
        </div>
      )}
    </div>
  );
}
