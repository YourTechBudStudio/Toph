import { Bot } from 'lucide-react';

import type { ProviderConnection } from '@toph/desktop-contracts';

import { Button } from '../button';
import { SettingsIcon, SettingsRow, SettingsSection, StatusBadge } from './settings-controls';

export function ProviderSection({
  id,
  provider,
  busy,
  onConnect,
  onRemove,
}: {
  id?: string;
  provider: ProviderConnection | undefined;
  busy: boolean;
  onConnect: () => void;
  onRemove: () => void;
}) {
  const connected = provider?.status === 'connected';
  const canConnect = Boolean(provider && (!connected || provider.error));
  const connectLabel = connected || provider?.status === 'invalid' ? 'Reconnect' : 'Connect';

  return (
    <SettingsSection
      id={id}
      eyebrow="Providers"
      description="Connect your transcription service to enable dictation."
    >
      {!provider && (
        <SettingsRow
          label="No provider available"
          description="Toph could not find a configured transcription provider."
        />
      )}

      {provider && (
        <>
          <SettingsRow
            label={provider.label}
            description={provider.description}
            icon={
              <SettingsIcon tone="blue">
                <Bot size={17} strokeWidth={1.8} />
              </SettingsIcon>
            }
          >
            <StatusBadge
              active={connected}
              activeLabel="Connected"
              inactiveLabel="Needs setup"
              inactiveTone="amber"
            />
          </SettingsRow>

          {provider.error && (
            <SettingsRow label="Provider error" description={provider.error} tone="danger" />
          )}

          <div className="flex justify-end gap-2 px-4 py-3">
            {canConnect && (
              <Button
                variant="primary"
                onClick={onConnect}
                disabled={busy || provider.status === 'connecting'}
              >
                {connectLabel}
              </Button>
            )}
            <Button variant="danger" onClick={onRemove} disabled={busy || !connected}>
              Remove
            </Button>
          </div>
        </>
      )}
    </SettingsSection>
  );
}
