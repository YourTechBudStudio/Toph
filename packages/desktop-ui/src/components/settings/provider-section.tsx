import type { ProviderConnection, ProviderId } from '@toph/desktop-contracts';

import { Button } from '../button';
import { SettingsIcon, SettingsRow, SettingsSection, StatusBadge } from './settings-controls';

export function ProviderSection({
  providers,
  busyProvider,
  onConnect,
  onRemove,
}: {
  providers: ProviderConnection[];
  busyProvider: ProviderId | null;
  onConnect: (providerId: ProviderId) => void;
  onRemove: (providerId: ProviderId) => void;
}) {
  return (
    <SettingsSection
      eyebrow="Providers"
      description="Connect the providers Toph needs for transcription and polish inference."
    >
      {providers.length === 0 && (
        <SettingsRow
          label="No provider available"
          description="Toph could not find any configured providers."
        />
      )}

      {providers.map((provider) => {
        const connected = provider.status === 'connected';
        const canConnect = !connected || provider.error;
        const connectLabel = connected || provider.status === 'invalid' ? 'Reconnect' : 'Connect';
        const busy = busyProvider !== null;

        return (
          <div key={provider.id}>
            <SettingsRow
              label={provider.label}
              description={provider.description}
              icon={
                <SettingsIcon tone={provider.id === 'antigravity' ? 'violet' : 'blue'}>
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="10" cy="7" r="4" />
                    <path d="M4 17c0-3.3 2.7-6 6-6s6 2.7 6 6" />
                  </svg>
                </SettingsIcon>
              }
            >
              <StatusBadge
                active={connected}
                activeLabel="Connected"
                inactiveLabel={provider.status === 'connecting' ? 'Connecting' : 'Needs setup'}
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
                  onClick={() => onConnect(provider.id)}
                  disabled={busy || provider.status === 'connecting'}
                >
                  {connectLabel}
                </Button>
              )}
              <Button
                variant="danger"
                onClick={() => onRemove(provider.id)}
                disabled={busy || !connected}
              >
                Remove
              </Button>
            </div>
          </div>
        );
      })}
    </SettingsSection>
  );
}
